import { SCORE_MODEL_VERSION, isTerminalScanEvent, type ScanEvent, type ScanSnapshot } from '@sitehp.app/core';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, notExists, or, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { appendEvent, type ScanSignal, type ScanStore, type SiteLog } from '@modules/scans/ports.ts';
import { scanEvents, scans, sites } from '@modules/scans/infrastructure/postgres/schema.ts';

/** Either driver: postgres.js in production, PGlite in tests. The queries are the same. */
export type Db = PgDatabase<PgQueryResultHKT, { scans: typeof scans; scanEvents: typeof scanEvents; sites: typeof sites }>;

const PAGE = 200;

/**
 * The score model of a stored scan: the snapshot's own, or for one stored before the snapshot carried it, the column (written by the
 * worker that completed the scan).
 */
const withModelVersion = ({ snapshot, engineVersion }: { snapshot: ScanSnapshot; engineVersion: number }): ScanSnapshot => ({
    ...snapshot,
    scoreModelVersion: snapshot.scoreModelVersion ?? (snapshot.status === 'completed' ? engineVersion : null),
});

/**
 * Scans in PostgreSQL: the snapshot beside its columns, and the event log in its own table. An event (with the one derived from it, if any)
 * and the snapshot it changes are written in one transaction on the locked scan row, so two writers cannot hand out the same event id and a
 * failed fold leaves both as they were.
 *
 * A follower reads the log from the database and wakes when this process publishes; with nothing to wake it, it looks again
 * every `pollMs`. That makes it correct with a worker in another process too, at the price of up to `pollMs` of delay.
 * With a `signal` (Redis pub/sub) a follower in the API wakes at once when a worker in another process publishes; the look every `pollMs`
 * stays as the fallback for a missed signal.
 */
/** `deleteBatch`: how many scans one retention statement deletes, so a large backlog never becomes one long lock. */
export const createPostgresScanStore = (db: Db, pollMs = 1000, signal?: ScanSignal, deleteBatch = 1000): ScanStore => {
    // One entry per open stream, for as long as the stream is open: a publish here or a signal from another process marks it and ends its wait.
    type Follower = { pending: boolean; wake?: (() => void) | undefined };
    const followers = new Map<string, Set<Follower>>();

    const notifyFollowers = (publicId: string) => {
        for (const follower of followers.get(publicId) ?? []) {
            follower.pending = true;
            follower.wake?.();
        }
    };

    const waitForChange = (aborted: AbortSignal, follower: Follower): Promise<void> =>
        new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                follower.wake = undefined;
                aborted.removeEventListener('abort', done);
                resolve();
            };
            const timer = setTimeout(done, pollMs);
            follower.wake = done;
            aborted.addEventListener('abort', done, { once: true });
        });

    const followLog = async function* (publicId: string, afterId: string | undefined, aborted: AbortSignal, follower: Follower): AsyncGenerator<ScanEvent> {
        let cursor = afterId !== undefined && /^\d+$/.test(afterId) ? Number(afterId) : 0;
        while (!aborted.aborted) {
            // Cleared before the reads: a change that lands while they run makes the loop read again instead of waiting.
            follower.pending = false;
            // The status is read before the log: the terminal event and the status change in one transaction, so a scan that is
            // finished here has all its events in the log below.
            const [scan] = await db.select({ status: scans.status }).from(scans).where(eq(scans.publicId, publicId));
            // Deleted while followed: nothing more will come.
            if (scan === undefined) return;
            const rows = await db
                .select({ event: scanEvents.event })
                .from(scanEvents)
                .where(and(eq(scanEvents.scanId, publicId), gt(scanEvents.id, cursor)))
                .orderBy(asc(scanEvents.id))
                .limit(PAGE);
            for (const { event } of rows) {
                cursor = Number(event.id);
                yield event;
                if (isTerminalScanEvent(event)) return;
            }
            if (rows.length === PAGE) continue;
            // Resumed at or after the end (EventSource reconnects after the server closes): nothing more will come.
            if (rows.length === 0 && scan.status !== 'running') return;
            if (rows.length === 0 && !follower.pending) await waitForChange(aborted, follower);
        }
    };

    return {
        create: async (snapshot) => {
            await db.insert(scans).values({
                publicId: snapshot.publicId,
                domain: snapshot.domain,
                url: snapshot.url,
                status: snapshot.status,
                score: snapshot.score,
                engineVersion: SCORE_MODEL_VERSION,
                createdAt: new Date(snapshot.createdAt),
                snapshot,
            });
        },

        get: async (publicId) => {
            const [row] = await db.select({ snapshot: scans.snapshot, engineVersion: scans.engineVersion }).from(scans).where(eq(scans.publicId, publicId));
            return row === undefined ? undefined : withModelVersion(row);
        },

        publish: async (publicId, draft, derive, runId) => {
            const result = await db.transaction(async (tx) => {
                const [row] = await tx.select({ snapshot: scans.snapshot }).from(scans).where(eq(scans.publicId, publicId)).for('update');
                if (row === undefined) throw new Error(`unknown scan ${publicId}`);
                const { event, followUp, snapshot } = appendEvent(publicId, row.snapshot, draft, derive, runId);
                const events = followUp === undefined ? [event] : [event, followUp];
                await tx.insert(scanEvents).values(events.map((appended) => ({ scanId: publicId, id: Number(appended.id), type: appended.type, ts: new Date(appended.ts), event: appended })));
                const last = followUp ?? event;
                await tx
                    .update(scans)
                    .set({
                        snapshot,
                        status: snapshot.status,
                        score: snapshot.score,
                        ...(isTerminalScanEvent(last) ? { finishedAt: new Date(last.ts) } : {}),
                        // The score is the finishing worker's: its model version is the one that counts, not the one of the API that queued it.
                        ...(events.some((appended) => appended.type === 'scan.completed') ? { engineVersion: SCORE_MODEL_VERSION } : {}),
                    })
                    .where(eq(scans.publicId, publicId));
                return { event, ...(followUp === undefined ? {} : { followUp }), snapshot };
            });
            notifyFollowers(publicId);
            // A follower in another process learns of it at once; if the signal is lost it finds the event on its next look.
            // Not awaited: the event is already stored, and a slow Redis must not hold up the scan.
            void signal?.notify(publicId).catch(() => undefined);
            return result;
        },

        follow: async function* (publicId, afterId, aborted) {
            // Registered for the whole stream, not per wait, so no change is missed between a read and the wait after it.
            // (Only a signal from another process in the moment before Redis confirms the subscription waits for the next look.)
            const follower: Follower = { pending: false };
            const set = followers.get(publicId) ?? new Set<Follower>();
            followers.set(publicId, set);
            set.add(follower);
            const unsubscribe = signal?.subscribe(publicId, () => notifyFollowers(publicId));
            try {
                yield* followLog(publicId, afterId, aborted, follower);
            } finally {
                unsubscribe?.();
                set.delete(follower);
                if (set.size === 0 && followers.get(publicId) === set) followers.delete(publicId);
            }
        },

        findRecent: async (url, since) => {
            // A running scan's column is the version of the API that queued it; a completed one's, the version of its score.
            // Full scans only: a newer scan with a choice of checks must not hide the full one behind it.
            const [row] = await db
                .select({ snapshot: scans.snapshot, engineVersion: scans.engineVersion })
                .from(scans)
                .where(and(eq(scans.url, url), ne(scans.status, 'failed'), eq(scans.engineVersion, SCORE_MODEL_VERSION), gte(scans.createdAt, since), isNull(sql`${scans.snapshot}->'selectedChecks'`)))
                .orderBy(desc(scans.createdAt))
                .limit(1);
            return row === undefined ? undefined : withModelVersion(row);
        },

        listRunningIdleSince: async (cutoff) => {
            const rows = await db
                .select({ publicId: scans.publicId })
                .from(scans)
                .where(
                    and(
                        eq(scans.status, 'running'),
                        // Created later, it cannot have been idle that long; this also keeps the query on the partial index of running scans.
                        lt(scans.createdAt, cutoff),
                        notExists(
                            db
                                .select({ id: scanEvents.id })
                                .from(scanEvents)
                                .where(and(eq(scanEvents.scanId, scans.publicId), gte(scanEvents.ts, cutoff))),
                        ),
                    ),
                );
            return rows.map((row) => row.publicId);
        },

        deleteOlderThan: async (cutoff) => {
            let total = 0;
            for (;;) {
                const batch = db.select({ publicId: scans.publicId }).from(scans).where(lt(scans.createdAt, cutoff)).limit(deleteBatch);
                const removed = await db.delete(scans).where(inArray(scans.publicId, batch)).returning({ publicId: scans.publicId });
                for (const { publicId } of removed) notifyFollowers(publicId);
                total += removed.length;
                if (removed.length < deleteBatch) return total;
            }
        },
    };
};

/** The permanent list of scanned domains in PostgreSQL. */
export const createPostgresSiteLog = (db: Db): SiteLog => ({
    // One statement, so concurrent requests for the same domain each add their 1 (PostgreSQL locks the row for the update).
    recordRequest: async (domain, at, outcome) => {
        const blocked = outcome === 'blocked' ? 1 : 0;
        const scan = outcome === 'scan' ? 1 : 0;
        await db
            .insert(sites)
            .values({ domain, firstSeenAt: at, lastSeenAt: at, requestCount: 1 - blocked, scanCount: scan, blockedCount: blocked })
            .onConflictDoUpdate({
                target: sites.domain,
                set: {
                    lastSeenAt: sql`greatest(${sites.lastSeenAt}, excluded.last_seen_at)`,
                    requestCount: sql`${sites.requestCount} + ${1 - blocked}`,
                    scanCount: sql`${sites.scanCount} + ${scan}`,
                    blockedCount: sql`${sites.blockedCount} + ${blocked}`,
                },
            });
    },

    recordResult: async (domain, score, scannedAt) => {
        await db
            .update(sites)
            .set({ lastScore: score, lastScanAt: scannedAt })
            .where(and(eq(sites.domain, domain), or(isNull(sites.lastScanAt), lte(sites.lastScanAt, scannedAt))));
    },

    list: async () =>
        db
            .select()
            .from(sites)
            .orderBy(sql`${sites.lastSeenAt} desc`),
});
