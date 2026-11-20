import { describe, expect, it } from 'vitest';
import { isReportPath } from '@lib/reportHeaders';
import { printPathOf, utcStamp } from '@lib/reportPrint';

describe('report for paper', () => {
    it('lives under the report, so it is as private as the report', () => {
        const path = printPathOf('en', 'a'.repeat(22));
        expect(path).toBe(`/en/r/${'a'.repeat(22)}/print`);
        expect(isReportPath(path)).toBe(true);
    });

    it('writes the scan time in UTC, to the minute, the same for every reader', () => {
        expect(utcStamp('2026-10-13T19:10:45.123Z')).toBe('2026-10-13 19:10 UTC');
    });
});
