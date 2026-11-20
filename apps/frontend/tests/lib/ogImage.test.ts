import { emptySnapshot, type CheckResult, type ScanSnapshot } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { renderOgImage } from '@lib/ogImage';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const check = (checkId: string, category: CheckResult['category'], status: CheckResult['status']): CheckResult =>
    ({ checkId, category, group: 'headers', severity: 'medium', status, pointsLost: status === 'fail' ? 5 : 0, evidence: {} }) as unknown as CheckResult;

const snapshot = (overrides: Partial<ScanSnapshot>): ScanSnapshot => ({
    ...emptySnapshot({ publicId: 'AAAAAAAAAAAAAAAAAAAAAA', url: 'https://example.com/', domain: 'example.com', createdAt: '2026-10-11T10:00:00.000Z', totalChecks: 2 }),
    ...overrides,
});

describe('renderOgImage', () => {
    it('draws a finished report as a 1200 × 630 PNG', async () => {
        const png = await renderOgImage(snapshot({ status: 'completed', score: 84, checks: [check('hsts', 'security', 'pass'), check('seo_title', 'seo', 'fail')] }), 'en');
        expect([...png.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
        expect(png.readUInt32BE(16)).toBe(1200);
        expect(png.readUInt32BE(20)).toBe(630);
    });

    it('draws a running scan without a score', async () => {
        const png = await renderOgImage(snapshot({ status: 'running' }), 'en');
        expect([...png.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
    });
});
