import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '@lib/api';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the API client of the frontend', () => {
    it('sends a fresh Idempotency-Key with every scan it starts, and none on a read', async () => {
        const seen: Array<string | null> = [];
        vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
            seen.push(new Headers(init?.headers).get('idempotency-key'));
            return Promise.resolve(new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }));
        });
        const api = createApi();
        await api.createScan('example.com').catch(() => undefined);
        await api.createScan('example.com').catch(() => undefined);
        await api.getScan('a'.repeat(22)).catch(() => undefined);
        expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
        expect(seen[1]).toMatch(/^[0-9a-f-]{36}$/);
        expect(seen[1]).not.toBe(seen[0]);
        expect(seen[2]).toBeNull();
    });
});
