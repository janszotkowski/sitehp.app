import { describe, expect, it } from 'vitest';
import { createLogger } from '@platform/logger.ts';

const capture = () => {
    const lines: string[] = [];
    return { lines, stream: { write: (line: string) => void lines.push(line) } };
};

describe('createLogger', () => {
    it('writes JSON with the level as a word and the service name', () => {
        const { lines, stream } = capture();
        createLogger({ LOG_LEVEL: 'info' }, 'api', stream).info({ scanId: 'abc' }, 'hello');
        const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
        expect(entry).toMatchObject({ level: 'info', service: 'api', msg: 'hello', scanId: 'abc' });
        expect(typeof entry['time']).toBe('string');
    });

    it('redacts secrets by path', () => {
        const { lines, stream } = capture();
        createLogger({ LOG_LEVEL: 'info' }, 'api', stream).info(
            { req: { headers: { authorization: 'Bearer secret', cookie: 'sid=1' } }, user: { apiKey: 'sk-live', token: 't', password: 'p', email: 'a@b.c' } },
            'x',
        );
        const text = lines[0] ?? '';
        for (const secret of ['Bearer secret', 'sid=1', 'sk-live', 'a@b.c']) expect(text).not.toContain(secret);
        expect(text).toContain('[redacted]');
    });

    it('stays silent at the silent level', () => {
        const { lines, stream } = capture();
        createLogger({ LOG_LEVEL: 'silent' }, 'api', stream).error('nothing');
        expect(lines).toEqual([]);
    });
});
