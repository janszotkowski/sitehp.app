import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { streamEvents } from '@src/client/stream.ts';

type Tick = { n: number };

const sse = (...ids: number[]): string => ids.map((n) => `id: ${n}\nevent: tick\ndata: ${JSON.stringify({ n })}\n\n`).join('');

const bodyOf = (text: string): Response => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });

const base = {
    url: 'http://api.test/stream',
    parse: (message: { data: string }): Tick => JSON.parse(message.data) as Tick,
    isTerminal: (event: Tick) => event.n >= 3,
    retry: { maxAttempts: 3, baseDelayMs: 1 },
};

describe('streamEvents', () => {
    it('delivers events in order and stops at the terminal event', async () => {
        const seen: number[] = [];
        const handle = streamEvents({ ...base, fetch: () => Promise.resolve(bodyOf(sse(1, 2, 3, 4))), onEvent: (event) => seen.push(event.n) });
        await handle.done;
        expect(seen).toEqual([1, 2, 3]);
    });

    it('resumes with Last-Event-ID after a dropped connection, with no gap and no duplicate', async () => {
        const seen: number[] = [];
        const headers: Array<string | null> = [];
        const responses = [bodyOf(sse(1, 2)), bodyOf(sse(3))];
        const handle = streamEvents({
            ...base,
            fetch: (_input, init) => {
                headers.push(new Headers(init?.headers).get('last-event-id'));
                return Promise.resolve(responses.shift() ?? bodyOf(''));
            },
            onEvent: (event) => seen.push(event.n),
        });
        await handle.done;
        expect(seen).toEqual([1, 2, 3]);
        expect(headers).toEqual([null, '2']);
    });

    it('leaves no abort listener behind after waiting to reconnect', async () => {
        let signal: AbortSignal | undefined;
        const responses = [bodyOf(sse(1)), bodyOf(sse(2)), bodyOf(sse(3))];
        const handle = streamEvents({
            ...base,
            fetch: (_input, init) => {
                signal = init?.signal ?? undefined;
                return Promise.resolve(responses.shift() ?? bodyOf(''));
            },
            onEvent: () => undefined,
        });
        await handle.done;
        if (signal === undefined) throw new Error('no signal was passed to fetch');
        // Two waits happened (after the first and the second connection); neither left its listener.
        expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    });

    it('retries a network failure and then gives up with an error', async () => {
        let calls = 0;
        const errors: Error[] = [];
        const handle = streamEvents({
            ...base,
            fetch: () => {
                calls += 1;
                return Promise.reject(new TypeError('network down'));
            },
            onEvent: () => undefined,
            onError: (error) => errors.push(error),
        });
        await handle.done;
        expect(calls).toBe(4);
        expect(errors).toHaveLength(1);
    });

    it('does not retry a client error and reports the API error code', async () => {
        let calls = 0;
        const errors: Error[] = [];
        const handle = streamEvents({
            ...base,
            fetch: () => {
                calls += 1;
                return Promise.resolve(Response.json({ error: { code: 'NOT_FOUND', message: 'No such scan.' } }, { status: 404 }));
            },
            onEvent: () => undefined,
            onError: (error) => errors.push(error),
        });
        await handle.done;
        expect(calls).toBe(1);
        expect(errors[0]).toMatchObject({ name: 'ApiError', code: 'NOT_FOUND', status: 404 });
    });

    it('retries a server error', async () => {
        const seen: number[] = [];
        const responses = [Response.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 503 }), bodyOf(sse(1, 2, 3))];
        const handle = streamEvents({ ...base, fetch: () => Promise.resolve(responses.shift() ?? bodyOf('')), onEvent: (event) => seen.push(event.n) });
        await handle.done;
        expect(seen).toEqual([1, 2, 3]);
    });

    it('stops with the error when an event does not match the contract', async () => {
        const errors: Error[] = [];
        const handle = streamEvents({
            ...base,
            fetch: () => Promise.resolve(bodyOf(sse(1))),
            parse: () => {
                throw new Error('bad event');
            },
            onEvent: () => undefined,
            onError: (error) => errors.push(error),
        });
        await handle.done;
        expect(errors.map((error) => error.message)).toEqual(['bad event']);
    });

    it('ends quietly when the caller closes the stream', async () => {
        const errors: Error[] = [];
        let resolveFetch: (response: Response) => void = () => undefined;
        const handle = streamEvents({
            ...base,
            fetch: () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
            onEvent: () => undefined,
            onError: (error) => errors.push(error),
        });
        handle.close();
        resolveFetch(bodyOf(''));
        await handle.done;
        expect(errors).toEqual([]);
    });
});
