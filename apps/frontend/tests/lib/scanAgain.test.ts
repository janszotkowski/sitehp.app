import { CHECKS } from '@sitehp.app/core/browser';
import { describe, expect, it } from 'vitest';
import { canScanAgain, checksToScanAgain } from '@components/ScanAgain';

describe('canScanAgain', () => {
    it('offers a new scan of a stored address, but not of one whose query values were hidden', () => {
        expect(canScanAgain('https://example.com/')).toBe(true);
        expect(canScanAgain('https://example.com/?lang')).toBe(true);
        expect(canScanAgain('https://example.com/?token=…&lang=…')).toBe(false);
    });
});

describe('checksToScanAgain', () => {
    it('keeps the known checks, drops removed ones, and falls back to a full scan when nothing is left to choose', () => {
        expect(checksToScanAgain(undefined)).toBeUndefined();
        expect(checksToScanAgain(['http_status', 'hsts', 'gone_check'])).toEqual(['http_status', 'hsts']);
        expect(checksToScanAgain(['http_status', 'gone_check'])).toBeUndefined();
        expect(checksToScanAgain(CHECKS.map((check) => check.id))).toBeUndefined();
        expect(checksToScanAgain(new Set(['http_status', 'hsts']))).toEqual(['http_status', 'hsts']);
    });
});
