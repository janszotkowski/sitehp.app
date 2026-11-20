import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { errorBody } from '@platform/errors.ts';
import type { Logger } from '@platform/logger.ts';

/** One server-sent message: `id` resumes a reconnect, `event` is the event type, `data` is serialised as JSON. */
export type SseMessage = {
    id: string;
    event: string;
    data: unknown;
};

export type SseSource = (context: { lastEventId: string | undefined; signal: AbortSignal }) => AsyncIterable<SseMessage>;

export type SseOptions = {
    heartbeatMs: number;
    /** Ends the stream from the server side, e.g. on shutdown. The client resumes elsewhere with `Last-Event-ID`. */
    signal?: AbortSignal;
    /** The request's logger: a failing source and the end of every stream are logged with its request id. */
    logger: Pick<Logger, 'info' | 'warn' | 'error'>;
    /** Called once when the stream ends, however it ends, or when it is refused (a caller counting open streams decrements here). */
    onClose?: () => void;
    /** Streams this process holds open at most; one more is answered 503 with `Retry-After`. Each is a socket and a follower. */
    maxOpen?: number;
    /** The count of open streams `maxOpen` applies to, shared by the streams of one app; without it a stream counts only itself. */
    streams?: { open: number };
};

/** Seconds a refused client waits before it tries again: streams end as scans finish, so a slot frees up soon. */
const BUSY_RETRY_AFTER_SEC = 5;

/** Why a stream ended: the source finished, the client went away, the server ended it (shutdown) or the source failed. */
export type SseEndReason = 'complete' | 'client' | 'server' | 'error';

/**
 * Streams a source as server-sent events. It is the only place that knows
 * about SSE framing, so every stream (scan events today, anything later)
 * behaves the same:
 *
 * - `Last-Event-ID` is handed to the source, which replays what was missed;
 * - a heartbeat comment keeps proxies from closing an idle connection;
 * - buffering is off (`X-Accel-Buffering: no`) and `Cache-Control: no-cache, no-transform`
 *   stops intermediaries from touching it;
 * - the source is aborted as soon as the client goes away, or when `signal` aborts (shutdown);
 * - a source that throws is logged and the stream simply ends: the client gets no error text
 *   (it would reveal internals) and resumes with `Last-Event-ID` like after any dropped connection;
 * - the end of every stream is logged (`stream closed`) with how long it was open, how many events
 *   it carried, why it ended and how many streams are still open. The access log line of the
 *   request is written when the stream opens, so its duration says nothing about the stream;
 * - above `maxOpen` streams in this process a new one is refused with 503 and `Retry-After`.
 */
export const sseResponse = (c: Context, source: SseSource, { heartbeatMs, signal, logger, onClose, maxOpen = Number.POSITIVE_INFINITY, streams = { open: 0 } }: SseOptions): Response => {
    const lastEventId = c.req.header('last-event-id');

    if (streams.open >= maxOpen) {
        onClose?.();
        logger.warn({ openStreams: streams.open, maxOpen }, 'stream refused: too many open streams');
        c.set('errorCode', 'INTERNAL');
        c.header('Retry-After', String(BUSY_RETRY_AFTER_SEC));
        return c.json(errorBody('INTERNAL', 'The server holds too many open event streams. Try again shortly.', c.get('requestId') as string | undefined), 503);
    }
    // Counted here, not when the stream starts, so a burst of requests cannot all pass the check before any is counted.
    streams.open += 1;

    const response = streamSSE(c, async (stream) => {
        const startedAt = performance.now();
        let events = 0;
        let reason: SseEndReason = 'complete';

        const controller = new AbortController();
        const end = (why: SseEndReason) => {
            if (!controller.signal.aborted) reason = why;
            controller.abort();
        };
        const serverStop = () => end('server');
        stream.onAbort(() => end('client'));
        if (signal?.aborted === true) serverStop();
        signal?.addEventListener('abort', serverStop, { once: true });

        const heartbeat = setInterval(() => {
            stream.write(': heartbeat\n\n').catch(() => end('client'));
        }, heartbeatMs);

        try {
            for await (const message of source({ lastEventId, signal: controller.signal })) {
                if (controller.signal.aborted) break;
                await stream.writeSSE({ id: message.id, event: message.event, data: JSON.stringify(message.data) });
                events += 1;
            }
        } catch (error) {
            // After an abort, or on a write to a client that has gone, the error is the stream ending, not a failure of ours.
            if (stream.aborted) end('client');
            if (!controller.signal.aborted) {
                reason = 'error';
                logger.error({ err: error }, 'event stream failed');
            }
        } finally {
            clearInterval(heartbeat);
            signal?.removeEventListener('abort', serverStop);
            streams.open -= 1;
            onClose?.();
            logger.info({ durationMs: Math.round(performance.now() - startedAt), events, reason, openStreams: streams.open }, 'stream closed');
        }
    });

    // Set after `streamSSE`, which writes a bare `no-cache`: `no-transform` also stops intermediaries
    // from rewriting the stream, and `X-Accel-Buffering: no` turns off reverse-proxy buffering.
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    return response;
};
