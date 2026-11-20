import { apiErrorFromResponse } from './errors.ts';
import { createSseParser, type SseMessage } from './sse-parser.ts';

/** Same values as the web `RequestCredentials`, declared here so core types do not depend on the DOM lib. */
export type StreamCredentials = 'omit' | 'same-origin' | 'include';

export type StreamRetry = {
    /** Reconnects after an interrupted connection before giving up. */
    maxAttempts: number;
    /** First delay; it doubles every attempt, capped at 10 s. */
    baseDelayMs: number;
};

export type StreamOptions<Event> = {
    url: string;
    fetch: typeof fetch;
    credentials?: StreamCredentials | undefined;
    /** Validates one raw message into a typed event. Throwing stops the stream with the error. */
    parse: (message: SseMessage) => Event;
    /** A terminal event ends the stream for good: no reconnect after it. */
    isTerminal: (event: Event) => boolean;
    onEvent: (event: Event) => void;
    onOpen?: (() => void) | undefined;
    /** Called once when the stream ends because of a failure: a fatal HTTP error, an invalid event or exhausted retries. */
    onError?: ((error: Error) => void) | undefined;
    retry?: StreamRetry | undefined;
    /** Resume after this event id from the very first connection (the snapshot the page already has). */
    lastEventId?: string | undefined;
};

export type StreamHandle = {
    /** Stops the stream and aborts the request. */
    close: () => void;
    /** Resolves when the stream has ended, for any reason. */
    done: Promise<void>;
};

const DEFAULT_RETRY: StreamRetry = { maxAttempts: 5, baseDelayMs: 500 };
const MAX_DELAY_MS = 10_000;

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            // The wait ended on time: the listener must not stay on the signal for the life of the stream.
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });

/**
 * Follows a server-sent event stream with `fetch`, so it works in the browser,
 * in Node and in the CLI, sends cookies when asked to, and can be tested
 * against the real server without a DOM.
 *
 * It does what `EventSource` does and what the architecture requires: a
 * dropped connection reconnects with `Last-Event-ID`, so no event is lost and
 * none is delivered twice. Unlike `EventSource` it stops on a fatal HTTP error
 * (4xx) instead of retrying forever, and it ends cleanly at a terminal event.
 */
export const streamEvents = <Event>(options: StreamOptions<Event>): StreamHandle => {
    const controller = new AbortController();
    const retry = options.retry ?? DEFAULT_RETRY;

    const run = async (): Promise<void> => {
        let lastEventId: string | undefined = options.lastEventId;
        let attempt = 0;

        while (!controller.signal.aborted) {
            // `finished`: a terminal event arrived (or the stream failed for good). `fatal`: the reason, if it failed.
            let finished = false;
            let fatal: Error | undefined;

            try {
                const response = await options.fetch(options.url, {
                    headers: { Accept: 'text/event-stream', ...(lastEventId === undefined ? {} : { 'Last-Event-ID': lastEventId }) },
                    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
                    signal: controller.signal,
                });

                if (!response.ok) {
                    const error = await apiErrorFromResponse(response);
                    // A client error will not fix itself; a server error is worth another try.
                    if (response.status < 500) {
                        fatal = error;
                        finished = true;
                    } else {
                        throw error;
                    }
                } else if (response.body === null) {
                    throw new Error('The response has no body.');
                } else {
                    options.onOpen?.();
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    const parser = createSseParser((message) => {
                        if (finished) return;
                        let event: Event;
                        try {
                            event = options.parse(message);
                        } catch (error) {
                            fatal = error instanceof Error ? error : new Error(String(error));
                            finished = true;
                            return;
                        }
                        if (message.id !== undefined) lastEventId = message.id;
                        attempt = 0;
                        options.onEvent(event);
                        if (options.isTerminal(event)) finished = true;
                    });

                    while (!finished) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        parser.push(decoder.decode(value, { stream: true }));
                    }
                    if (finished) await reader.cancel().catch(() => undefined);
                }
            } catch {
                // Network failure or a server error: reconnect below, unless the caller closed the stream.
                if (controller.signal.aborted) return;
            }

            if (fatal !== undefined) {
                options.onError?.(fatal);
                return;
            }
            if (finished) return;

            // The connection ended or failed without a terminal event: resume after Last-Event-ID.
            attempt += 1;
            if (attempt > retry.maxAttempts) {
                options.onError?.(new Error('The stream was interrupted and could not be resumed.'));
                return;
            }
            await wait(Math.min(retry.baseDelayMs * 2 ** (attempt - 1), MAX_DELAY_MS), controller.signal);
        }
    };

    return { close: () => controller.abort(), done: run() };
};
