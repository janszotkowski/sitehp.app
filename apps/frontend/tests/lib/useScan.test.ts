import { emptySnapshot, type ScanSnapshot } from '@sitehp.app/core';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanQueryKey, scanQueryOptions } from '@lib/useScan';

const initial = emptySnapshot({ publicId: 'a'.repeat(22), url: 'https://example.com/', domain: 'example.com', createdAt: '2026-10-11T10:00:00.000Z', totalChecks: 45 });
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const failure = (code: string, status: number) => json({ error: { code, message: code } }, status);

/** Polls once through the real options and waits until the query settles (succeeds or fails for good). */
const pollOnce = async (client: QueryClient) => {
    const observer = new QueryObserver(client, { ...scanQueryOptions(initial, true), refetchInterval: false });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false), { timeout: 5000 });
    unsubscribe();
    return observer;
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('scanQueryOptions', () => {
    it('takes a fresh snapshot from a poll', async () => {
        const later: ScanSnapshot = { ...initial, lastEventId: '7', preliminary: false };
        vi.stubGlobal('fetch', () => json(later));
        const result = (await pollOnce(new QueryClient())).getCurrentResult();
        expect(result.data?.lastEventId).toBe('7');
    });

    it('keeps the snapshot further along when a poll brings an older one', async () => {
        const client = new QueryClient();
        const ahead: ScanSnapshot = { ...initial, lastEventId: '12' };
        client.setQueryData(scanQueryKey(initial.publicId), ahead);
        vi.stubGlobal('fetch', () => json({ ...initial, lastEventId: '3' }));
        expect((await pollOnce(client)).getCurrentResult().data?.lastEventId).toBe('12');
    });

    it('stops at once on a refusal for good, without retrying', async () => {
        const fetch = vi.fn(() => failure('NOT_FOUND', 404));
        vi.stubGlobal('fetch', fetch);
        const result = (await pollOnce(new QueryClient())).getCurrentResult();
        expect(result.status).toBe('error');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('retries a failure that may pass, counting the failures in a row', async () => {
        vi.useFakeTimers();
        try {
            const fetch = vi.fn(() => failure('INTERNAL', 503));
            vi.stubGlobal('fetch', fetch);
            const observer = new QueryObserver(new QueryClient(), { ...scanQueryOptions(initial, true), refetchInterval: false });
            const unsubscribe = observer.subscribe(() => undefined);
            // TanStack Query's backoff: 1 s, then 2 s, then 4 s.
            await vi.advanceTimersByTimeAsync(7_100);
            expect(fetch).toHaveBeenCalledTimes(4);
            expect(observer.getCurrentResult().failureCount).toBe(4);
            expect(observer.getCurrentResult().status).toBe('success');
            unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });
});
