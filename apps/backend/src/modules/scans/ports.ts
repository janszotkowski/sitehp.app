import { reduceScan, type CertificateInfo, type FetchedPage, type ScanEvent, type ScanFailureReason, type ScanSnapshot } from '@sitehp.app/core';

/** An event as the use-case describes it; the store assigns the id. */
export type ScanEventDraft = Omit<ScanEvent, 'id'>;

/**
 * Where scans live: the stored snapshot and the ordered log of its events, behind one port so
 * that the two can never disagree. PostgreSQL in production (snapshot and events table written in one
 * transaction; followers in other processes are woken over Redis pub/sub, `ScanSignal`); memory in
 * development and tests.
 *
 * Event ids are the 1-based position of the event in the scan's log (`eventIdSchema` in the
 * contract), so a reader resumes by number. An adapter keeps that sequence; it never exposes
 * an id of its own storage (such as a Redis Streams id).
 */
export type ScanStore = {
    create: (snapshot: ScanSnapshot) => Promise<void>;
    get: (publicId: string) => Promise<ScanSnapshot | undefined>;
    /**
     * Applies `appendEvent` to the stored scan under a lock and writes the result: the event (and its follow-up) is appended to the
     * log and the snapshot replaced in one step. Either both change or neither does: if the rule refuses or the write fails, the log
     * and the snapshot stay as they were. Rejects with `ScanFinishedError` for a scan that has ended, `RunTakenOverError` for a run
     * that was taken over, and an error for an unknown scan.
     */
    publish: (publicId: string, draft: ScanEventDraft, derive?: (snapshot: ScanSnapshot) => ScanEventDraft | undefined, runId?: string) => Promise<AppendedEvents>;
    /**
     * Replays everything after `afterId`, then waits for new events, and ends after a terminal
     * one, including when the terminal event is at or before `afterId` (a reader resuming after
     * the end gets an empty, finished stream, not one that waits for ever).
     */
    follow: (publicId: string, afterId: string | undefined, signal: AbortSignal) => AsyncIterable<ScanEvent>;
    /**
     * The latest full scan (no choice of checks) of exactly this URL created at or after `since` that has not failed (running or completed)
     * and was made with the current score model (`SCORE_MODEL_VERSION`), to hand out again instead of scanning anew.
     */
    findRecent: (url: string, since: Date) => Promise<ScanSnapshot | undefined>;
    /** Public ids of scans still `running` with no event at or after `cutoff`: the candidates for a lost job. */
    listRunningIdleSince: (cutoff: Date) => Promise<string[]>;
    /** Forgets every scan created before `cutoff` with its log (retention); how many were removed. */
    deleteOlderThan: (cutoff: Date) => Promise<number>;
};

/**
 * Tells followers in other processes that a scan changed, so a live stream sees an event at once instead of on its next look
 * (a worker publishes, the API serves the stream). A missed signal costs only the delay of that next look.
 */
export type ScanSignal = {
    notify: (publicId: string) => Promise<void>;
    /** Calls `onWake` for every signal about this scan, until the returned function is called. */
    subscribe: (publicId: string, onWake: () => void) => () => void;
};

/** What is kept for good about a domain someone asked to scan. Only the host: no path, no query, no caller. */
export type SiteRecord = {
    domain: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    /** Every request for the domain that was not blocked: scans started, recent scans handed out again, requests over the rate limit. */
    requestCount: number;
    /** Scans actually started (the site was fetched). */
    scanCount: number;
    blockedCount: number;
    lastScore: number | null;
    lastScanAt: Date | null;
};

export type SiteRequestOutcome = 'scan' | 'reused' | 'limited' | 'blocked';

/** The permanent list of scanned domains, apart from the reports, which expire. */
export type SiteLog = {
    /**
     * A visitor asked for this domain. `scan`: a scan was started. `reused`: a recent scan was handed out again. `limited`: refused by the
     * rate limit. `blocked`: the domain is blocked. Every outcome but `blocked` counts as a request.
     */
    recordRequest: (domain: string, at: Date, outcome: SiteRequestOutcome) => Promise<void>;
    /** A scan of the domain, started at `scannedAt`, finished with this score (`null` when it has none). An older scan never overwrites a newer one's. */
    recordResult: (domain: string, score: number | null, scannedAt: Date) => Promise<void>;
    /** Most recently seen first. */
    list: () => Promise<SiteRecord[]>;
};

/**
 * `url` is the address as typed, query values included: the stored snapshot keeps only the query keys, so the worker needs it to
 * fetch the right page. A job queued before it existed falls back to the stored address.
 * `httpFallback`: the address was typed without a scheme (`firma.cz`), so when https cannot be reached at all the worker tries http once.
 */
export type ScanJob = { publicId: string; url?: string; httpFallback?: boolean };

/** Hands work to a runner. In memory it runs after the response; BullMQ runs it in a worker process. */
export type JobQueue = {
    enqueue: (job: ScanJob) => Promise<void>;
    /** True while the scan's job waits or runs; false when it ended or is gone (a lost Redis). Rejects when the queue cannot tell. */
    isPending: (publicId: string) => Promise<boolean>;
};

export type SiteFetchResult = { ok: true; page: FetchedPage } | { ok: false; reason: ScanFailureReason };

/**
 * Fetches the page of a scanned site. The only way a scan touches a stranger's server, so
 * the one implementation is the SSRF-safe fetcher (`platform/net/safe-fetch.ts`); tests use
 * a fake that never opens a socket.
 */
export type SiteFetcher = {
    /**
     * `accept` replaces the default `Accept` header, to ask for another format of the same address (Markdown). `signal` stops the fetch (the scan ran out of time).
     * `stayOnSite`: a redirect to another registrable domain (`www.` or a subdomain is the same site) is not followed and the fetch answers
     * `unreachable`, so the side probes of a scan never send the scanner to a server the scanned site chose.
     */
    fetchPage: (url: string, options?: { accept?: string; signal?: AbortSignal; stayOnSite?: boolean }) => Promise<SiteFetchResult>;
    /** The certificate on port 443 of a host, trusted or not; `null` when no TLS answers. */
    inspectCertificate: (host: string) => Promise<CertificateInfo | null>;
    /** Releases the connections it holds. Called once, on shutdown. */
    close: () => Promise<void>;
};

/** A store refuses an event for a scan that has already ended. */
export class ScanFinishedError extends Error {
    constructor(publicId: string) {
        super(`scan ${publicId} has already ended`);
        this.name = 'ScanFinishedError';
    }
}

/** A store refuses an event of a run that another run has taken over (a stalled job that BullMQ handed to a second worker). */
export class RunTakenOverError extends ScanFinishedError {
    constructor(publicId: string) {
        super(publicId);
        this.message = `scan ${publicId} is run by another worker`;
        this.name = 'RunTakenOverError';
    }
}

/**
 * The run rule, around the fold. The first event of a run claims a scan no run owns yet (the API's `scan.started` names none);
 * a `scan.started` of a run takes the scan over; any other event of a run that does not own the scan is refused.
 * Without `runId` the fold is unchanged.
 */
const foldForRun =
    (publicId: string, fold: (current: ScanSnapshot, event: ScanEvent) => ScanSnapshot, runId: string | undefined) =>
    (current: ScanSnapshot, event: ScanEvent): ScanSnapshot => {
        if (runId === undefined) return fold(current, event);
        const owner = current.runId ?? null;
        if (owner !== null && owner !== runId && event.type !== 'scan.started') throw new RunTakenOverError(publicId);
        return { ...fold(current, event), runId };
    };

export type AppendedEvents = { event: ScanEvent; followUp?: ScanEvent; snapshot: ScanSnapshot };

/**
 * What appending one event does to a scan, worked out before anything is written: a scan that has ended takes no more events
 * (`ScanFinishedError`: a reaped scan whose worker still runs, a job run twice); the event gets the id after the snapshot's last one (ids are the
 * 1-based position in the log, so a reader resumes by number) and is folded into the snapshot under the run rule (`runId`: the worker run
 * that publishes; without it, the API and the reaper, the event is not tied to a run). `derive` may add one more event from the folded
 * snapshot (the score after a check), numbered and folded right after it. Every store applies this under its own lock, then writes.
 * `fold` is only for tests.
 */
export const appendEvent = (
    publicId: string,
    current: ScanSnapshot,
    draft: ScanEventDraft,
    derive?: (snapshot: ScanSnapshot) => ScanEventDraft | undefined,
    runId?: string,
    fold: (current: ScanSnapshot, event: ScanEvent) => ScanSnapshot = reduceScan,
): AppendedEvents => {
    if (current.status !== 'running') throw new ScanFinishedError(publicId);
    const step = foldForRun(publicId, fold, runId);
    const lastId = Number(current.lastEventId ?? 0);
    const event = { ...draft, id: String(lastId + 1) } as ScanEvent;
    let snapshot = step(current, event);
    const next = derive?.(snapshot);
    if (next === undefined) return { event, snapshot };
    const followUp = { ...next, id: String(lastId + 2) } as ScanEvent;
    snapshot = step(snapshot, followUp);
    return { event, followUp, snapshot };
};
