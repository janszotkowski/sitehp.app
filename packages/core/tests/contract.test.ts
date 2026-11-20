import { describe, expect, it } from 'vitest';
import { errorResponseSchema, eventEnvelope, eventIdSchema, healthResponseSchema, scanSnapshotSchema } from '@src/index.ts';
import { z } from 'zod';

describe('error contract', () => {
    it('accepts a stable code with optional details', () => {
        const parsed = errorResponseSchema.safeParse({ error: { code: 'VALIDATION_FAILED', message: 'bad', details: [{ path: 'count', message: 'too big' }] } });
        expect(parsed.success).toBe(true);
    });

    it('rejects a code that is not part of the contract', () => {
        expect(errorResponseSchema.safeParse({ error: { code: 'WHATEVER', message: 'x' } }).success).toBe(false);
    });
});

describe('event envelope', () => {
    it('requires id, a literal type, an ISO time and typed data', () => {
        const schema = eventEnvelope('x.done', z.object({ ok: z.boolean() }));
        expect(schema.safeParse({ id: '1', type: 'x.done', ts: '2026-10-09T12:00:00.000Z', data: { ok: true } }).success).toBe(true);
        expect(schema.safeParse({ id: '', type: 'x.done', ts: '2026-10-09T12:00:00.000Z', data: { ok: true } }).success).toBe(false);
        expect(schema.safeParse({ id: '1', type: 'other', ts: '2026-10-09T12:00:00.000Z', data: { ok: true } }).success).toBe(false);
        expect(schema.safeParse({ id: '1', type: 'x.done', ts: 'yesterday', data: { ok: true } }).success).toBe(false);
    });
});

describe('event ids', () => {
    it('are positions in the log: positive decimal integers, because resuming and folding compare them as numbers', () => {
        for (const id of ['1', '8', '42', '100000']) expect(eventIdSchema.safeParse(id).success).toBe(true);
        // A Redis Streams id, a zero, a leading zero, a negative or non-numeric value would break the ordering.
        for (const id of ['1700000000000-0', '0', '01', '-1', 'abc', '1.5', ' 1']) expect(eventIdSchema.safeParse(id).success).toBe(false);
    });

    it('apply to the lastEventId of a snapshot as well', () => {
        const snapshot = {
            publicId: 'a'.repeat(22),
            status: 'running',
            url: 'https://example.com/',
            domain: 'example.com',
            createdAt: '2026-10-09T12:00:00.000Z',
            totalChecks: 3,
            checks: [],
            score: null,
            preliminary: true,
            failureReason: null,
            responseHeaders: null,
        };
        expect(scanSnapshotSchema.safeParse({ ...snapshot, lastEventId: '3' }).success).toBe(true);
        expect(scanSnapshotSchema.safeParse({ ...snapshot, lastEventId: '1700000000000-0' }).success).toBe(false);
    });
});

describe('health contract', () => {
    it('describes the health response', () => {
        expect(healthResponseSchema.safeParse({ status: 'ok', service: 'backend', version: 'dev', uptimeSeconds: 3, time: '2026-10-09T12:00:00.000Z' }).success).toBe(true);
    });

    it('refuses a response that says anything but ok', () => {
        expect(healthResponseSchema.safeParse({ status: 'degraded', service: 'backend', version: 'dev', uptimeSeconds: 3, time: '2026-10-09T12:00:00.000Z' }).success).toBe(false);
    });
});
