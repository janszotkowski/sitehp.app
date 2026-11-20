import { SCORE_MODEL_VERSION, isTerminalScanEvent, type ScanEvent, type ScanSnapshot } from '@sitehp.app/core';
import { systemClock, type Clock } from '@platform/ports.ts';
import { ScanFinishedError, foldForRun, type JobQueue, type ScanJob, type ScanStore, type SiteLog, type SiteRecord } from '@modules/scans/ports.ts';

type Entry = { snapshot: ScanSnapshot; log: ScanEvent[]; finishedAt?: number };

export type ScanRetention = { clock: Clock; ttlMs: number; maxScans: number };

const DEFAULT_RETENTION: ScanRetention = { clock: systemClock, ttlMs: 86_400_000, maxScans: 1000 };

/**
 * Scans in memory (development without a database, and tests). Memory is lost on restart and must not grow, so it forgets: a finished scan after `ttlMs`, and above `maxScans` the oldest
 * finished ones first. Only a store full of unfinished scans gives up its oldest running one, so the cap always holds.
 */
export const createInMemoryScanStore = ({ clock, ttlMs, maxScans }: ScanRetention = DEFAULT_RETENTION): ScanStore => {
    // A Map iterates in insertion order, so the first entries are the oldest scans.
    const scans = new Map<string, Entry>();
    const waiters = new Map<string, Set<() => void>>();

    const wake = (publicId: string) => {
        for (const resolve of waiters.get(publicId) ?? []) resolve();
        waiters.delete(publicId);
    };

    const waitForChange = (publicId: string, signal: AbortSignal): Promise<void> =>
        new Promise((resolve) => {
            const set = waiters.get(publicId) ?? new Set<() => void>();
            waiters.set(publicId, set);
            const done = () => {
                set.delete(done);
                // Woken by an event, not by the abort: the listener must not stay on the signal, or every wait adds one more.
                signal.removeEventListener('abort', done);
                resolve();
            };
            set.add(done);
            signal.addEventListener('abort', done, { once: true });
        });

    const evict = (publicId: string) => {
        scans.delete(publicId);
        // A reader still waiting on it ends instead of waiting for ever.
        wake(publicId);
    };

    // Lazily, on every new scan: a pass over at most `maxScans` entries.
    const sweep = () => {
        const now = clock.now().getTime();
        for (const [publicId, entry] of scans) if (entry.finishedAt !== undefined && now - entry.finishedAt >= ttlMs) evict(publicId);
        for (const [publicId, entry] of scans) {
            if (scans.size < maxScans) break;
            if (entry.finishedAt !== undefined) evict(publicId);
        }
        for (const publicId of scans.keys()) {
            if (scans.size < maxScans) break;
            evict(publicId);
        }
    };

    return {
        create: (snapshot) => {
            sweep();
            scans.set(snapshot.publicId, { snapshot, log: [] });
            return Promise.resolve();
        },

        get: (publicId) => Promise.resolve(scans.get(publicId)?.snapshot),

        findRecent: (url, since) =>
            Promise.resolve(
                [...scans.values()]
                    .map((entry) => entry.snapshot)
                    .filter(
                        (snapshot) =>
                            snapshot.url === url &&
                            snapshot.status !== 'failed' &&
                            snapshot.selectedChecks === undefined &&
                            (snapshot.scoreModelVersion ?? SCORE_MODEL_VERSION) === SCORE_MODEL_VERSION &&
                            new Date(snapshot.createdAt) >= since,
                    )
                    .at(-1),
            ),

        listRunningIdleSince: (cutoff) =>
            Promise.resolve(
                [...scans.values()]
                    .filter((entry) => entry.snapshot.status === 'running' && new Date(entry.log.at(-1)?.ts ?? entry.snapshot.createdAt) < cutoff)
                    .map((entry) => entry.snapshot.publicId),
            ),

        deleteOlderThan: (cutoff) => {
            let removed = 0;
            for (const [publicId, entry] of scans) {
                if (new Date(entry.snapshot.createdAt) < cutoff) {
                    evict(publicId);
                    removed += 1;
                }
            }
            return Promise.resolve(removed);
        },

        publish: (publicId, draft, plainFold, derive, runId) => {
            const fold = foldForRun(publicId, plainFold, runId);
            const entry = scans.get(publicId);
            if (entry === undefined) return Promise.reject(new Error(`unknown scan ${publicId}`));
            if (entry.snapshot.status !== 'running') return Promise.reject(new ScanFinishedError(publicId));
            // Ids are the 1-based position in the log, so a reader resumes by number.
            const event = { ...draft, id: String(entry.log.length + 1) } as ScanEvent;
            // Everything that can throw runs before anything changes: the log and the snapshot move together or not at all.
            let snapshot: ScanSnapshot;
            let followUp: ScanEvent | undefined;
            try {
                snapshot = fold(entry.snapshot, event);
                const next = derive?.(snapshot);
                if (next !== undefined) {
                    followUp = { ...next, id: String(entry.log.length + 2) } as ScanEvent;
                    snapshot = fold(snapshot, followUp);
                }
            } catch (error) {
                return Promise.reject(error instanceof Error ? error : new Error(String(error)));
            }
            entry.log.push(event, ...(followUp === undefined ? [] : [followUp]));
            entry.snapshot = snapshot;
            if (isTerminalScanEvent(followUp ?? event)) entry.finishedAt = clock.now().getTime();
            wake(publicId);
            return Promise.resolve({ event, ...(followUp === undefined ? {} : { followUp }), snapshot });
        },

        follow: async function* (publicId, afterId, signal) {
            let cursor = afterId !== undefined && /^\d+$/.test(afterId) ? Number(afterId) : 0;
            while (!signal.aborted) {
                const entry = scans.get(publicId);
                // Evicted while followed: nothing more will come.
                if (entry === undefined) return;
                const log = entry.log;
                while (cursor < log.length) {
                    const event = log[cursor];
                    cursor += 1;
                    if (event === undefined) continue;
                    yield event;
                    if (isTerminalScanEvent(event)) return;
                }
                // The reader resumed at or after the end (EventSource reconnects after the server closes): nothing more will come.
                const last = log.at(-1);
                if (last !== undefined && isTerminalScanEvent(last)) return;
                await waitForChange(publicId, signal);
            }
        },
    };
};

/** The list of scanned domains in memory: for development without a database and for tests. */
export const createInMemorySiteLog = (): SiteLog => {
    const sites = new Map<string, SiteRecord>();
    const seen = (domain: string, at: Date): SiteRecord => {
        const known = sites.get(domain) ?? { domain, firstSeenAt: at, lastSeenAt: at, requestCount: 0, scanCount: 0, blockedCount: 0, lastScore: null, lastScanAt: null };
        sites.set(domain, known);
        return known;
    };
    return {
        recordRequest: (domain, at, outcome) => {
            const site = seen(domain, at);
            site.lastSeenAt = at;
            if (outcome === 'blocked') site.blockedCount += 1;
            else site.requestCount += 1;
            if (outcome === 'scan') site.scanCount += 1;
            return Promise.resolve();
        },
        recordResult: (domain, score, scannedAt) => {
            const site = sites.get(domain);
            if (site !== undefined && (site.lastScanAt === null || site.lastScanAt <= scannedAt)) {
                site.lastScore = score;
                site.lastScanAt = scannedAt;
            }
            return Promise.resolve();
        },
        list: () => Promise.resolve([...sites.values()].sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime()).map((site) => ({ ...site }))),
    };
};

/**
 * Runs the job right after the current turn of the event loop, in this process,
 * so the HTTP response goes out first, and at most `concurrency` at once: the rest
 * wait in order (the scan stays as it was created until its turn). Failures are the
 * runner's to report as `scan.failed`; the queue only guards against an unhandled rejection.
 */
export const createInlineJobQueue = (run: (job: ScanJob) => Promise<void>, onError: (error: unknown) => void, concurrency = 8): JobQueue => {
    const waiting: ScanJob[] = [];
    const pending = new Set<string>();
    let active = 0;

    const next = () => {
        while (active < concurrency && waiting.length > 0) {
            const job = waiting.shift() as ScanJob;
            active += 1;
            setTimeout(() => {
                run(job)
                    .catch(onError)
                    .finally(() => {
                        active -= 1;
                        pending.delete(job.publicId);
                        next();
                    });
            }, 0);
        }
    };

    return {
        enqueue: (job) => {
            pending.add(job.publicId);
            waiting.push(job);
            next();
            return Promise.resolve();
        },
        isPending: (publicId) => Promise.resolve(pending.has(publicId)),
    };
};
