import type { ScanSnapshot } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { createLru, ogCacheKey } from '@lib/ogRoute';

const snap = (status: ScanSnapshot['status'], score: number | null, lastEventId: string | null) => ({ publicId: 'a'.repeat(22), status, score, lastEventId });

describe('share preview cache', () => {
    it('keys a picture by the report and what it shows, so a running scan is drawn again as it moves on', () => {
        expect(ogCacheKey(snap('completed', 80, '40'))).toBe(ogCacheKey(snap('completed', 80, '40')));
        expect(ogCacheKey(snap('running', null, '3'))).not.toBe(ogCacheKey(snap('running', null, '4')));
        expect(ogCacheKey(snap('running', null, '40'))).not.toBe(ogCacheKey(snap('completed', 80, '40')));
    });

    it('keeps the most recently used entries and drops the oldest past its size', () => {
        const lru = createLru<number>(2);
        lru.set('a', 1);
        lru.set('b', 2);
        expect(lru.get('a')).toBe(1);
        lru.set('c', 3);
        expect(lru.get('b')).toBeUndefined();
        expect(lru.get('a')).toBe(1);
        expect(lru.get('c')).toBe(3);
    });
});
