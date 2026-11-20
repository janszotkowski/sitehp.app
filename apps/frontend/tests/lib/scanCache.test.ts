import type { ScanSnapshot } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { rememberSnapshot, takeSnapshot } from '@lib/scanCache';

const snapshot = { publicId: 'a'.repeat(22) } as ScanSnapshot;

describe('scan cache', () => {
    it('hands a remembered snapshot over once, so a later visit loads fresh state', () => {
        rememberSnapshot(snapshot);
        expect(takeSnapshot(snapshot.publicId)).toBe(snapshot);
        expect(takeSnapshot(snapshot.publicId)).toBeUndefined();
    });

    it('knows nothing about an id it was never given', () => {
        expect(takeSnapshot('b'.repeat(22))).toBeUndefined();
    });
});
