import { ApiError, SCORE_MODEL_VERSION, type ScanSnapshot } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { isFatalPollError, newerSnapshot, olderScoreModel } from '@lib/scanSnapshot';

const snap = (lastEventId: string | null, status: ScanSnapshot['status'] = 'running', publicId = 'a'.repeat(22)) => ({ publicId, status, lastEventId }) as ScanSnapshot;

describe('newer snapshot', () => {
    it('keeps whichever has folded the later event, so an out-of-order poll never moves progress back', () => {
        const old = snap('3');
        const fresh = snap('12');
        expect(newerSnapshot(old, fresh)).toBe(fresh);
        expect(newerSnapshot(fresh, old)).toBe(fresh);
        expect(newerSnapshot(snap(null), old)).toBe(old);
    });

    it('adopts a finished snapshot on a tie, and keeps the current one otherwise', () => {
        const current = snap('5');
        const done = snap('5', 'completed');
        expect(newerSnapshot(current, done)).toBe(done);
        expect(newerSnapshot(current, snap('5'))).toBe(current);
    });

    it('takes another scan’s snapshot as it is', () => {
        const other = snap('1', 'running', 'b'.repeat(22));
        expect(newerSnapshot(snap('9'), other)).toBe(other);
    });
});

describe('fatal poll error', () => {
    it('stops on a 4xx, but not on a 429, a 5xx or a network failure', () => {
        expect(isFatalPollError(new ApiError('NOT_FOUND', 'gone', 404))).toBe(true);
        expect(isFatalPollError(new ApiError('RATE_LIMITED', 'slow down', 429))).toBe(false);
        expect(isFatalPollError(new ApiError('INTERNAL', 'oops', 500))).toBe(false);
        expect(isFatalPollError(new TypeError('fetch failed'))).toBe(false);
    });
});

describe('older score model', () => {
    const scored = (status: ScanSnapshot['status'], scoreModelVersion?: number | null) => ({ ...snap('9', status), scoreModelVersion }) as ScanSnapshot;

    it('names the version of a finished report scored with an earlier model, and nothing otherwise', () => {
        expect(olderScoreModel(scored('completed', SCORE_MODEL_VERSION - 1))).toBe(SCORE_MODEL_VERSION - 1);
        expect(olderScoreModel(scored('completed', SCORE_MODEL_VERSION))).toBeUndefined();
        // Stored before the version was kept, still running, or failed: nothing to compare.
        expect(olderScoreModel(scored('completed'))).toBeUndefined();
        expect(olderScoreModel(scored('running', null))).toBeUndefined();
        expect(olderScoreModel(scored('failed', null))).toBeUndefined();
    });
});
