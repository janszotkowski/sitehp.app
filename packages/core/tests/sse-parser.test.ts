import { describe, expect, it } from 'vitest';
import { createSseParser, type SseMessage } from '@src/client/sse-parser.ts';

const parse = (...chunks: string[]): SseMessage[] => {
    const messages: SseMessage[] = [];
    const parser = createSseParser((message) => messages.push(message));
    for (const chunk of chunks) parser.push(chunk);
    return messages;
};

describe('createSseParser', () => {
    it('parses id, event and data', () => {
        expect(parse('id: 7\nevent: demo.tick\ndata: {"n":1}\n\n')).toEqual([{ id: '7', event: 'demo.tick', data: '{"n":1}' }]);
    });

    it('defaults the event name to message', () => {
        expect(parse('data: hi\n\n')).toEqual([{ id: undefined, event: 'message', data: 'hi' }]);
    });

    it('joins multi-line data with a newline', () => {
        expect(parse('data: a\ndata: b\n\n')[0]?.data).toBe('a\nb');
    });

    it('ignores comments such as heartbeats', () => {
        expect(parse(': heartbeat\n\ndata: x\n\n')).toEqual([{ id: undefined, event: 'message', data: 'x' }]);
    });

    it('accepts \\n, \\r\\n and \\r line endings', () => {
        expect(parse('data: a\r\n\r\ndata: b\r\rdata: c\n\n').map((message) => message.data)).toEqual(['a', 'b', 'c']);
    });

    it('survives chunks that split a message, a field and a \\r\\n pair', () => {
        expect(parse('id: 1\nev', 'ent: x\nda', 'ta: y\r', '\n\r', '\n').map((message) => [message.id, message.event, message.data])).toEqual([['1', 'x', 'y']]);
    });

    it('keeps the last event id for later messages, as the spec says', () => {
        expect(parse('id: 1\ndata: a\n\ndata: b\n\n').map((message) => message.id)).toEqual(['1', '1']);
    });

    it('does not dispatch a message without data', () => {
        expect(parse('event: x\n\n')).toEqual([]);
    });

    it('strips only one leading space from a value', () => {
        expect(parse('data:  two\n\n')[0]?.data).toBe(' two');
    });
});
