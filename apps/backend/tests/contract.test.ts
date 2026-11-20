import { CRITICAL_CAP, createApiClient, reduceScan, type ScanEvent } from '@sitehp.app/core';
import { createApp } from '@composition/app.ts';
import { describe, expect, it } from 'vitest';
import { cannedPage, fakeFetcher, testApp, testContainer } from '@tests/helpers.ts';

/**
 * The client in core against the real Hono app (no network): the only way to be
 * sure that what the client sends is what the server accepts, and that what the
 * server answers is what the client's schemas expect. If either side changes the
 * contract alone, this file fails.
 */

const clientFor = (app: ReturnType<typeof testApp>, fetchOverride?: typeof fetch) =>
    createApiClient({
        baseUrl: 'http://api.test',
        fetch: fetchOverride ?? ((input, init) => Promise.resolve(app.request(String(input), init))),
    });

describe('client ↔ server contract', () => {
    it('health: the server answers what the client expects', async () => {
        const health = await clientFor(testApp()).health();
        expect(health).toMatchObject({ status: 'ok', service: 'backend', version: 'dev' });
    });

    it('scan stream: resumes after a dropped connection through Last-Event-ID, with no gap and no duplicate', async () => {
        const container = testContainer({ SCAN_STEP_DELAY_MS: '5' });
        const app = createApp(container);
        const seenHeaders: Array<string | null> = [];
        let call = 0;

        // The first connection is cut after two events, as a proxy or a flaky network would.
        const flaky: typeof fetch = async (input, init) => {
            const url = String(input);
            if (!url.endsWith('/events')) return app.request(url, init);
            call += 1;
            seenHeaders.push(new Headers(init?.headers).get('last-event-id'));
            const response = await app.request(url, init);
            if (call > 1) return response;
            const text = await response.text();
            const cut = text.split('\n\n').slice(0, 2).join('\n\n') + '\n\n';
            return new Response(cut, { status: response.status, headers: response.headers });
        };

        const client = clientFor(app, flaky);
        const { publicId } = await client.createScan('example.com');

        const events: ScanEvent[] = [];
        const handle = client.subscribeScan(publicId, { onEvent: (event) => events.push(event), retry: { maxAttempts: 2, baseDelayMs: 1 } });
        await handle.done;

        const ids = events.map((event) => Number(event.id));
        expect(ids).toEqual(ids.toSorted((a, b) => a - b));
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids[0]).toBe(1);
        expect(events.at(-1)?.type).toBe('scan.completed');
        expect(seenHeaders[0]).toBeNull();
        expect(seenHeaders[1]).toBe('2');
    });

    it('scan stream: an unknown scan is a NOT_FOUND ApiError, not a retry loop', async () => {
        const client = clientFor(testApp());
        const errors: Error[] = [];
        const handle = client.subscribeScan('x'.repeat(22), { onEvent: () => undefined, onError: (error) => errors.push(error), retry: { maxAttempts: 2, baseDelayMs: 1 } });
        await handle.done;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('errors: an unknown route is a NOT_FOUND ApiError carrying the request id', async () => {
        const app = testApp();
        const client = createApiClient({ baseUrl: 'http://api.test', fetch: (input, init) => Promise.resolve(app.request(String(input).replace('/v1/health', '/v1/missing'), init)) });
        await expect(client.health()).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404, requestId: expect.any(String) });
    });
});

describe('client ↔ server contract: scans', () => {
    it('createScan → subscribeScan builds the same state as getScan, resuming after the first snapshot', async () => {
        // A site that stays on http, so the score is not 100 and the folded state has something to agree on.
        const container = testContainer({ SCAN_STEP_DELAY_MS: '10' }, fakeFetcher({ ok: true, page: cannedPage({ finalUrl: 'http://example.com/' }) }));
        const app = createApp(container);
        const client = createApiClient({ baseUrl: 'http://api.test', fetch: (input, init) => Promise.resolve(app.request(String(input), init)) });

        const { publicId, snapshot } = await client.createScan('http://example.com');
        expect(snapshot.lastEventId).toBe('1');

        let state = snapshot;
        const handle = client.subscribeScan(publicId, {
            lastEventId: snapshot.lastEventId,
            onEvent: (event) => {
                state = reduceScan(state, event);
            },
            retry: { maxAttempts: 2, baseDelayMs: 1 },
        });
        await handle.done;

        expect(state).toMatchObject({ status: 'completed', score: CRITICAL_CAP, preliminary: false });
        expect(state).toEqual(await client.getScan(publicId));
    });

    it('createScan reports an unscannable address as a VALIDATION_FAILED ApiError naming the field', async () => {
        const app = testApp();
        const client = createApiClient({ baseUrl: 'http://api.test', fetch: (input, init) => Promise.resolve(app.request(String(input), init)) });
        await expect(client.createScan('ftp://example.com')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'url', message: 'UNSUPPORTED_SCHEME' }] });
    });

    it('getScan reports an unknown id as NOT_FOUND', async () => {
        const app = testApp();
        const client = createApiClient({ baseUrl: 'http://api.test', fetch: (input, init) => Promise.resolve(app.request(String(input), init)) });
        await expect(client.getScan('x'.repeat(22))).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });
});
