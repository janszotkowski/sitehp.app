import type { ScanEvent, ScanSnapshot } from '../contract/scan.ts';

/** A scan that has not produced an event yet. */
export const emptySnapshot = (base: Pick<ScanSnapshot, 'publicId' | 'url' | 'domain' | 'createdAt' | 'totalChecks' | 'selectedChecks'>): ScanSnapshot => ({
    ...base,
    status: 'running',
    checks: [],
    score: null,
    preliminary: true,
    failureReason: null,
    responseHeaders: null,
    technologies: [],
    lastEventId: null,
    scoreModelVersion: null,
});

/** Event ids are positions in the log (`eventIdSchema`), so they compare as numbers. */
const isNewer = (event: ScanEvent, lastEventId: string | null): boolean => lastEventId === null || Number(event.id) > Number(lastEventId);

/**
 * Folds one event into a snapshot. The backend uses it to keep the stored
 * snapshot, the browser and the CLI use it to build the same state from the
 * stream, so every consumer agrees. Events are idempotent: one that is not
 * newer than `lastEventId` (a replay after a reconnect) changes nothing.
 */
export const reduceScan = (snapshot: ScanSnapshot, event: ScanEvent): ScanSnapshot => {
    if (!isNewer(event, snapshot.lastEventId)) return snapshot;
    const next: ScanSnapshot = { ...snapshot, lastEventId: event.id };

    switch (event.type) {
        // A run begins: a second `scan.started` (a worker took the scan over, or a new version with another set of checks runs it)
        // starts from a clean slate, so results of the earlier run cannot mix with this one.
        case 'scan.started':
            return {
                ...next,
                url: event.data.url,
                domain: event.data.domain,
                totalChecks: event.data.totalChecks,
                checks: [],
                score: null,
                preliminary: true,
                responseHeaders: null,
                technologies: [],
                failureReason: null,
                scoreModelVersion: null,
            };
        case 'page.fetched':
            return { ...next, responseHeaders: event.data.headers, technologies: event.data.technologies ?? [] };
        case 'check.completed':
            return { ...next, checks: [...snapshot.checks.filter((check) => check.checkId !== event.data.checkId), event.data] };
        case 'score.updated':
            return { ...next, score: event.data.score, preliminary: true };
        case 'scan.completed':
            return { ...next, status: 'completed', score: event.data.score, preliminary: false, scoreModelVersion: event.data.scoreModelVersion ?? null };
        case 'scan.failed':
            return { ...next, status: 'failed', preliminary: false, failureReason: event.data.reason };
    }
};

export const isFinished = (snapshot: ScanSnapshot): boolean => snapshot.status !== 'running';
