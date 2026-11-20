/** One parsed server-sent message. `id` is the last event id seen, `event` defaults to `message`. */
export type SseMessage = {
    id: string | undefined;
    event: string;
    data: string;
};

export type SseParser = {
    /** Feed decoded text; complete messages are delivered through `onMessage`. */
    push: (chunk: string) => void;
};

/**
 * A pure parser of the `text/event-stream` format (comments, `id`, `event`,
 * multi-line `data`, any line ending). It has no DOM and no network, so the
 * same code runs in the browser, in Node and in the CLI, and is tested alone.
 * Chunks may split anywhere, including between `\r` and `\n`.
 */
export const createSseParser = (onMessage: (message: SseMessage) => void): SseParser => {
    let buffer = '';
    let id: string | undefined;
    let event = '';
    let data: string[] = [];

    const dispatch = () => {
        if (data.length > 0) onMessage({ id, event: event === '' ? 'message' : event, data: data.join('\n') });
        event = '';
        data = [];
    };

    const processLine = (line: string) => {
        if (line === '') {
            dispatch();
            return;
        }
        if (line.startsWith(':')) return;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const raw = colon === -1 ? '' : line.slice(colon + 1);
        const value = raw.startsWith(' ') ? raw.slice(1) : raw;
        if (field === 'id' && !value.includes('\0')) id = value;
        else if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
    };

    return {
        push: (chunk) => {
            buffer += chunk;
            // A trailing `\r` may be the first half of `\r\n`: keep it for the next chunk.
            const carry = buffer.endsWith('\r') ? '\r' : '';
            const lines = buffer.slice(0, buffer.length - carry.length).split(/\r\n|\n|\r/);
            buffer = (lines.pop() ?? '') + carry;
            for (const line of lines) processLine(line);
        },
    };
};
