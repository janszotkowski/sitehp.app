import { createScanResponseSchema, errorResponseSchema, scanEventSchema } from '@sitehp.app/core';
import { createApp } from '@composition/app.ts';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { sseResponse, type SseOptions } from '@platform/sse.ts';
import { parseSse, testContainer } from '@tests/helpers.ts';

describe('the scan event stream: SSE framing', () => {
    const startedScan = async () => {
        const container = testContainer();
        const app = createApp(container);
        const created = createScanResponseSchema.parse(
            await (await app.request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'example.com' }) })).json(),
        );
        for (let attempt = 0; attempt < 200; attempt += 1) {
            if ((await container.scans.get(created.publicId)).status !== 'running') break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return { app, publicId: created.publicId };
    };

    it('streams text/event-stream without buffering or transformation, with an id and a type on every event', async () => {
        const { app, publicId } = await startedScan();
        const response = await app.request(`/v1/scans/${publicId}/events`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
        expect(response.headers.get('x-accel-buffering')).toBe('no');

        const { messages } = parseSse(await response.text());
        expect(messages.length).toBeGreaterThan(2);
        for (const message of messages) {
            const event = scanEventSchema.parse(JSON.parse(message.data ?? '{}'));
            expect(event.id).toBe(message.id);
            expect(event.type).toBe(message.event);
        }
    });

    it('ignores a Last-Event-ID that is not one of ours and starts from the beginning', async () => {
        const { app, publicId } = await startedScan();
        const response = await app.request(`/v1/scans/${publicId}/events`, { headers: { 'last-event-id': 'garbage' } });
        expect(parseSse(await response.text()).messages[0]?.id).toBe('1');
    });
});

type LogEntry = { level: 'info' | 'warn' | 'error'; fields: Record<string, unknown>; message: string };

/** A logger that keeps what it is given, so a test can read it back. */
const recordingLogger = () => {
    const entries: LogEntry[] = [];
    const write = (level: LogEntry['level']) => (fields: Record<string, unknown>, message: string) => void entries.push({ level, fields, message });
    return { entries, logger: { info: write('info'), warn: write('warn'), error: write('error') } as unknown as SseOptions['logger'] };
};

const quietLogger = () => recordingLogger().logger;

describe('sseResponse', () => {
    it('logs a source that fails, ends the stream and sends the client no error text', async () => {
        const { entries, logger } = recordingLogger();
        const app = new Hono();
        app.get('/s', (c) =>
            sseResponse(
                c,
                async function* () {
                    yield { id: '1', event: 'x', data: 1 };
                    throw new Error('database password is hunter2');
                },
                { heartbeatMs: 1000, logger },
            ),
        );
        const body = await (await app.request('/s')).text();
        expect(parseSse(body).messages).toEqual([{ id: '1', event: 'x', data: '1' }]);
        expect(body).not.toContain('hunter2');
        expect(entries.find((entry) => entry.level === 'error')).toMatchObject({ message: 'event stream failed', fields: { err: { message: 'database password is hunter2' } } });
        expect(entries.find((entry) => entry.message === 'stream closed')?.fields).toMatchObject({ reason: 'error', events: 1 });
    });

    it('logs the end of every stream: how long, how many events, why, and how many are still open', async () => {
        const { entries, logger } = recordingLogger();
        const app = new Hono();
        app.get('/s', (c) =>
            sseResponse(
                c,
                async function* () {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    yield { id: '1', event: 'x', data: 1 };
                    yield { id: '2', event: 'x', data: 2 };
                },
                { heartbeatMs: 1000, logger },
            ),
        );
        await (await app.request('/s')).text();
        const closed = entries.find((entry) => entry.message === 'stream closed');
        expect(closed?.fields).toMatchObject({ events: 2, reason: 'complete', openStreams: 0 });
        expect(closed?.fields['durationMs']).toBeGreaterThanOrEqual(25);
    });

    it('reports a stream the server ended (shutdown) as such', async () => {
        const { entries, logger } = recordingLogger();
        const stopping = new AbortController();
        const app = new Hono();
        app.get('/s', (c) =>
            sseResponse(
                c,
                async function* ({ signal }) {
                    yield { id: '1', event: 'x', data: 1 };
                    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
                },
                { heartbeatMs: 1000, signal: stopping.signal, logger },
            ),
        );
        const body = (await app.request('/s')).text();
        await new Promise((resolve) => setTimeout(resolve, 10));
        stopping.abort();
        await body;
        expect(entries.find((entry) => entry.message === 'stream closed')?.fields).toMatchObject({ events: 1, reason: 'server' });
    });

    it('sends heartbeat comments while the source is idle', async () => {
        const app = new Hono();
        app.get('/slow', (c) =>
            sseResponse(
                c,
                async function* () {
                    await new Promise((resolve) => setTimeout(resolve, 80));
                    yield { id: '1', event: 'x', data: { ok: true } };
                },
                { heartbeatMs: 10, logger: quietLogger() },
            ),
        );
        const { messages, comments } = parseSse(await (await app.request('/slow')).text());
        expect(comments.filter((comment) => comment === 'heartbeat').length).toBeGreaterThanOrEqual(2);
        expect(messages).toEqual([{ id: '1', event: 'x', data: '{"ok":true}' }]);
    });

    it('hands the Last-Event-ID header to the source', async () => {
        const app = new Hono();
        let seen: string | undefined;
        app.get('/s', (c) =>
            sseResponse(
                c,
                async function* ({ lastEventId }) {
                    seen = lastEventId;
                    yield { id: 'a', event: 'x', data: 1 };
                },
                { heartbeatMs: 1000, logger: quietLogger() },
            ),
        );
        await (await app.request('/s', { headers: { 'last-event-id': '42' } })).text();
        expect(seen).toBe('42');
    });
});

describe('the scan event stream: open streams per caller', () => {
    it('answers 429 above the limit of open streams of one address, and frees the slot when a stream closes', async () => {
        const container = testContainer({ SSE_MAX_STREAMS_PER_IP: '2', SCAN_STEP_DELAY_MS: '10000' });
        const app = createApp(container);
        const { publicId } = await container.scans.create('example.com');
        const open = () => app.request(`/v1/scans/${publicId}/events`);

        const first = await open();
        const second = await open();
        expect([first.status, second.status]).toEqual([200, 200]);
        // Read while open, as a browser does: the stream ends on shutdown below.
        const bodies = [second.text()];
        const refused = await open();
        expect(refused.status).toBe(429);
        expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);

        // The client goes away (the cancel itself settles only once the stream ends, so it is not awaited).
        void first.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const third = await open();
        expect(third.status).toBe(200);
        bodies.push(third.text());

        await container.close();
        await Promise.all(bodies);
    });
});

describe('the scan event stream: open streams per IPv6 network', () => {
    it('counts an IPv6 /48 too, at ten times the limit of one caller, so fresh /64s do not buy fresh streams', async () => {
        const container = testContainer({ SSE_MAX_STREAMS_PER_IP: '1', SCAN_STEP_DELAY_MS: '10000', TRUSTED_PROXY_HOPS: '1', TRUSTED_PROXY_CIDRS: '10.0.0.0/8' });
        const app = createApp(container);
        const { publicId } = await container.scans.create('example.com');
        const open = (forwarded: string) => app.request(`/v1/scans/${publicId}/events`, { headers: { 'x-forwarded-for': forwarded } }, { incoming: { socket: { remoteAddress: '10.0.0.1' } } });

        const bodies: Array<Promise<string>> = [];
        for (let n = 0; n < 10; n += 1) {
            const response = await open(`2a00:1:2:${n}::1`);
            expect(response.status).toBe(200);
            bodies.push(response.text());
        }
        expect((await open('2a00:1:2:ff::1')).status).toBe(429);
        // Another /48 is another network.
        const other = await open('2a00:1:3:0::1');
        expect(other.status).toBe(200);
        bodies.push(other.text());

        await container.close();
        await Promise.all(bodies);
    });
});

describe('the event streams of the whole process', () => {
    it('answers 503 with Retry-After above MAX_OPEN_STREAMS, from any caller, and frees the slot when a stream closes', async () => {
        const container = testContainer({ MAX_OPEN_STREAMS: '2', SSE_MAX_STREAMS_PER_IP: '3', SCAN_STEP_DELAY_MS: '10000' });
        const app = createApp(container);
        const { publicId } = await container.scans.create('example.com');
        const open = () => app.request(`/v1/scans/${publicId}/events`);

        const first = await open();
        const second = await open();
        expect([first.status, second.status]).toEqual([200, 200]);
        const bodies = [second.text()];
        const refused = await open();
        expect(refused.status).toBe(503);
        expect(refused.headers.get('retry-after')).toBe('5');
        expect(errorResponseSchema.parse(await refused.json()).error.code).toBe('INTERNAL');

        void first.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const third = await open();
        expect(third.status).toBe(200);
        bodies.push(third.text());
        // Still the process limit (503), not the caller's (429): the refused stream did not keep one of the caller's three slots.
        expect((await open()).status).toBe(503);

        await container.close();
        await Promise.all(bodies);
    });

    it('counts a stream from the moment it is answered, and calls onClose for a refused one', async () => {
        const { entries, logger } = recordingLogger();
        let closed = 0;
        const app = new Hono();
        const stopping = new AbortController();
        const streams = { open: 0 };
        app.get('/s', (c) =>
            sseResponse(
                c,
                async function* ({ signal }) {
                    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
                    yield* [];
                },
                { heartbeatMs: 1000, logger, signal: stopping.signal, maxOpen: 1, streams, onClose: () => void (closed += 1) },
            ),
        );
        // Both requests arrive before either stream has started.
        const [kept, refused] = await Promise.all([app.request('/s'), app.request('/s')]);
        expect([kept.status, refused.status]).toEqual([200, 503]);
        expect(closed).toBe(1);
        expect(entries.find((entry) => entry.level === 'warn')?.message).toBe('stream refused: too many open streams');
        stopping.abort();
        await kept.text();
        expect(closed).toBe(2);
    });
});
