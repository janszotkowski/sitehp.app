import { PUBLIC_ID_PATTERN } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { secureIdGenerator } from '@platform/ids.ts';

describe('secureIdGenerator', () => {
    it('produces ids that match the public id format', () => {
        for (let i = 0; i < 500; i += 1) expect(secureIdGenerator.next()).toMatch(PUBLIC_ID_PATTERN);
    });

    it('never produces two equal ids in a large sample', () => {
        const ids = new Set(Array.from({ length: 5000 }, () => secureIdGenerator.next()));
        expect(ids.size).toBe(5000);
    });

    it('never starts with a dash, which a command line would read as an option', () => {
        for (let i = 0; i < 5000; i += 1) expect(secureIdGenerator.next().startsWith('-')).toBe(false);
    });

    it('uses the whole alphabet in the first position, so the drawn-again rule does not skew it', () => {
        const first = new Set(Array.from({ length: 4000 }, () => secureIdGenerator.next()[0]));
        expect(first.size).toBeGreaterThan(40);
    });
});
