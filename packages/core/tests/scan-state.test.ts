import { describe, expect, it } from 'vitest';
import { emptySnapshot, isFinished, reduceScan, scanEventSchema, scanSnapshotSchema, type CheckResult, type ScanEvent } from '@src/index.ts';

const base = { publicId: 'a'.repeat(22), url: 'https://example.com/', domain: 'example.com', createdAt: '2026-10-09T12:00:00.000Z', totalChecks: 2 };
const ts = '2026-10-09T12:00:01.000Z';

const check = (id: string, status: 'pass' | 'fail'): CheckResult => ({
    checkId: id,
    category: 'security',
    layer: 'light',
    status,
    severity: 'high',
    effort: 'hours',
    evidence: {},
    pointsLost: status === 'fail' ? 5 : 0,
});

const events: ScanEvent[] = [
    { id: '1', type: 'scan.started', ts, data: { url: base.url, domain: base.domain, totalChecks: 2 } },
    { id: '2', type: 'check.completed', ts, data: check('https_scheme', 'pass') },
    { id: '3', type: 'score.updated', ts, data: { score: 100, preliminary: true } },
    { id: '4', type: 'check.completed', ts, data: check('url_length', 'pass') },
    { id: '5', type: 'scan.completed', ts, data: { score: 100 } },
];

describe('a scan started again', () => {
    it('drops the results of the earlier run and takes the new number of checks', () => {
        const halfway = events.slice(0, 3).reduce(reduceScan, emptySnapshot(base));
        expect(halfway.checks).toHaveLength(1);
        const again = reduceScan(halfway, { id: '4', type: 'scan.started', ts, data: { url: base.url, domain: base.domain, totalChecks: 3 } });
        expect(again).toMatchObject({ checks: [], score: null, preliminary: true, responseHeaders: null, totalChecks: 3, lastEventId: '4', status: 'running' });
    });
});

describe('the score model of a scan', () => {
    it('is the version scan.completed names, unknown until then and after a new start', () => {
        const started = reduceScan(emptySnapshot(base), { id: '1', type: 'scan.started', ts, data: { url: base.url, domain: base.domain, totalChecks: 2, runId: 'run-a' } });
        expect(started.scoreModelVersion).toBeNull();
        // The run id is the backend's bookkeeping: folding the stream leaves it out.
        expect(started.runId).toBeUndefined();
        const done = reduceScan(started, { id: '2', type: 'scan.completed', ts, data: { score: 90, scoreModelVersion: 3 } });
        expect(done.scoreModelVersion).toBe(3);
        // An event stored before the version existed leaves it unknown.
        expect(reduceScan(started, { id: '2', type: 'scan.completed', ts, data: { score: 90 } }).scoreModelVersion).toBeNull();
    });

    it('may be missing from a snapshot stored before it existed', () => {
        const old: Record<string, unknown> = { ...events.reduce(reduceScan, emptySnapshot(base)) };
        delete old['scoreModelVersion'];
        expect(scanSnapshotSchema.safeParse(old).success).toBe(true);
    });
});

describe('scan events', () => {
    it('validate against the discriminated union', () => {
        for (const event of events) expect(scanEventSchema.safeParse(event).success).toBe(true);
        expect(scanEventSchema.safeParse({ id: '1', type: 'scan.unknown', ts, data: {} }).success).toBe(false);
        // A failure reason that is not part of the contract is refused, so a client never has to guess a string.
        expect(scanEventSchema.safeParse({ id: '1', type: 'scan.failed', ts, data: { reason: 'because' } }).success).toBe(false);
        expect(scanEventSchema.safeParse({ id: '1', type: 'scan.failed', ts, data: { reason: 'blocked_address' } }).success).toBe(true);
    });
});

describe('reduceScan', () => {
    it('builds the final state by folding the events in order', () => {
        const final = events.reduce(reduceScan, emptySnapshot(base));
        expect(final).toMatchObject({ status: 'completed', score: 100, preliminary: false, lastEventId: '5' });
        expect(final.checks.map((result) => result.checkId)).toEqual(['https_scheme', 'url_length']);
        expect(isFinished(final)).toBe(true);
    });

    it('is running and preliminary until the scan completes', () => {
        const midway = events.slice(0, 3).reduce(reduceScan, emptySnapshot(base));
        expect(midway).toMatchObject({ status: 'running', score: 100, preliminary: true, lastEventId: '3' });
        expect(isFinished(midway)).toBe(false);
    });

    it('ignores a replayed event instead of applying it twice', () => {
        const once = events.slice(0, 2).reduce(reduceScan, emptySnapshot(base));
        const replayed = [events[0], events[1], events[1]].reduce((state, event) => (event === undefined ? state : reduceScan(state, event)), emptySnapshot(base));
        expect(replayed).toEqual(once);
        expect(replayed.checks).toHaveLength(1);
    });

    it('lets a client that already holds a snapshot resume without duplicates', () => {
        const snapshot = events.slice(0, 3).reduce(reduceScan, emptySnapshot(base));
        const resumed = events.reduce(reduceScan, snapshot);
        expect(resumed).toEqual(events.reduce(reduceScan, emptySnapshot(base)));
    });

    it('marks a failed scan as finished', () => {
        const failed = reduceScan(emptySnapshot(base), { id: '1', type: 'scan.failed', ts, data: { reason: 'internal_error' } });
        expect(failed).toMatchObject({ status: 'failed', preliminary: false, failureReason: 'internal_error' });
        expect(isFinished(failed)).toBe(true);
    });
});
