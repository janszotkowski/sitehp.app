import { CHECKS, SCORE_MODEL_VERSION, emptySnapshot, type CheckResult, type ScanSnapshot } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { reportView } from '@lib/reportView';

const check = (checkId: string, status: CheckResult['status']): CheckResult => {
    const meta = CHECKS.find((item) => item.id === checkId);
    if (meta === undefined) throw new Error(`unknown check ${checkId}`);
    return { checkId, category: meta.category, group: meta.group, severity: meta.severity, status, pointsLost: status === 'fail' ? 5 : 0, evidence: {} } as unknown as CheckResult;
};

const snapshot = (overrides: Partial<ScanSnapshot>): ScanSnapshot => ({
    ...emptySnapshot({ publicId: 'AAAAAAAAAAAAAAAAAAAAAA', url: 'https://example.com/', domain: 'example.com', createdAt: '2026-10-11T10:00:00.000Z', totalChecks: CHECKS.length }),
    ...overrides,
});

const checks = [check('hsts', 'pass'), check('seo_title', 'fail'), check('csp', 'warn')];

describe('reportView', () => {
    it('shows the score and the categories of a finished full scan everywhere', () => {
        const view = reportView(snapshot({ status: 'completed', score: 84, checks, scoreModelVersion: SCORE_MODEL_VERSION }));
        expect(view.rows).toHaveLength(CHECKS.length);
        expect(view.customized).toBe(false);
        expect(view.breakdown).not.toBeNull();
        expect(view.shareScore).toBe(84);
        expect(view.shareBreakdown).toBe(view.breakdown);
    });

    it('lists a customized scan only by its checks and keeps its score off the badge and the share image', () => {
        const view = reportView(snapshot({ status: 'completed', score: 100, checks, selectedChecks: ['hsts', 'seo_title', 'csp'] }));
        expect(view.rows.map((row) => row.id)).toEqual(CHECKS.filter((item) => ['hsts', 'seo_title', 'csp'].includes(item.id)).map((item) => item.id));
        expect(view.customized).toBe(true);
        expect(view.shareScore).toBeNull();
        expect(view.shareBreakdown).toBeNull();
    });

    it('shares no score while running or after a failure', () => {
        expect(reportView(snapshot({ status: 'running', score: 70, checks })).shareScore).toBeNull();
        expect(reportView(snapshot({ status: 'failed', score: 70, checks })).shareScore).toBeNull();
    });

    it('drops the categories of a report scored with an earlier model', () => {
        const view = reportView(snapshot({ status: 'completed', score: 84, checks, scoreModelVersion: SCORE_MODEL_VERSION - 1 }));
        expect(view.olderModel).toBe(SCORE_MODEL_VERSION - 1);
        expect(view.breakdown).toBeNull();
        expect(view.shareScore).toBe(84);
        expect(view.shareBreakdown).toBeNull();
    });

    it('orders what to fix by status, then gain, and splits off what passed and what was not measured', () => {
        const { todo, passed, unmeasured } = reportView(snapshot({ status: 'completed', score: 84, checks })).sections;
        expect(todo.map((row) => row.id)).toEqual(['seo_title', 'csp']);
        expect(passed.map((row) => row.id)).toEqual(['hsts']);
        expect(unmeasured).toHaveLength(CHECKS.length - 3);
    });
});
