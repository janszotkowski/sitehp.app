import { ApiError, SCORE_MODEL_VERSION, isFinished, type ScanSnapshot } from '@sitehp.app/core/browser';

const eventNumber = (snapshot: ScanSnapshot): number => (snapshot.lastEventId === null ? -1 : Number(snapshot.lastEventId));

/**
 * The later of two snapshots of one scan, so a late poll or a stale loader never moves progress back. Event ids
 * only grow; on a tie a finished snapshot wins, otherwise the current one stays. Another scan's snapshot replaces it.
 */
export const newerSnapshot = (current: ScanSnapshot, candidate: ScanSnapshot): ScanSnapshot => {
    if (candidate.publicId !== current.publicId) return candidate;
    const byEvent = eventNumber(candidate) - eventNumber(current);
    if (byEvent !== 0) return byEvent > 0 ? candidate : current;
    return isFinished(candidate) && !isFinished(current) ? candidate : current;
};

/** A 4xx will not change on retry (gone, forbidden, malformed); a 429 or a network error might, so those keep polling. */
export const isFatalPollError = (error: unknown): boolean => error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429;

/**
 * The score model version a finished report was scored with, when it is not today's: its HP stays as it was, but today's
 * weights would break its categories down differently, so they no longer add up to it. Undefined for a report of the current
 * model, a running or failed scan, or one stored before the version was kept.
 */
export const olderScoreModel = (snapshot: ScanSnapshot): number | undefined => {
    const version = snapshot.scoreModelVersion;
    return snapshot.status === 'completed' && typeof version === 'number' && version !== SCORE_MODEL_VERSION ? version : undefined;
};
