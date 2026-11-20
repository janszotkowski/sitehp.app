import { describe, expect, it } from 'vitest';
import { REPORT_HEADERS, isReportPath } from '@lib/reportHeaders';

describe('isReportPath', () => {
    it('matches report pages in any language', () => {
        expect(isReportPath('/en/r/abc')).toBe(true);
        expect(isReportPath('/de/r/abc')).toBe(true);
        // The preview image of a report is as private as the report: same headers.
        expect(isReportPath('/og/r/abc.png')).toBe(true);
    });

    it('does not match anything else', () => {
        for (const path of ['/en', '/en/status', '/en/r', '/r/abc', '/en/prices']) expect(isReportPath(path)).toBe(false);
    });
});

describe('REPORT_HEADERS', () => {
    it('keeps a report out of search results and out of the Referer header', () => {
        expect(REPORT_HEADERS).toEqual({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    });
});
