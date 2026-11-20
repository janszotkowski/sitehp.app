import { CATEGORIES, CHECKS, GROUPS, type CheckResult } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import {
    blockedStatus,
    filterCounts,
    findingOf,
    gainText,
    matchesQuery,
    reportAsJson,
    reportRows,
    rowsForFilter,
    rowsInCategory,
    selectionIn,
    skippedReasonLabel,
    STATUS_RANK,
    topFixes,
} from '@lib/reportModel';
import { categoryTitle, groupTitle } from '@lib/reportTitles';

const result = (checkId: string, status: CheckResult['status'], evidence: CheckResult['evidence'] = {}, pointsLost = 0): CheckResult => {
    const definition = CHECKS.find((check) => check.id === checkId);
    if (definition === undefined) throw new Error(`no check ${checkId}`);
    return { checkId, category: definition.category, layer: definition.layer, status, severity: definition.severity, effort: definition.effort, evidence, pointsLost };
};

describe('report rows', () => {
    it('lists every check of the registry exactly once, in registry order', () => {
        expect(reportRows([], false).map((row) => row.id)).toEqual(CHECKS.map((check) => check.id));
    });

    it('is running until a check reports, and skipped for a check a finished scan never ran', () => {
        expect(reportRows([], false)[0]?.status).toBe('running');
        expect(reportRows([], true)[0]?.status).toBe('skipped');
        expect(reportRows([result('hsts', 'fail', {}, 5)], true).find((row) => row.id === 'hsts')?.status).toBe('fail');
    });

    it('carries what fixing a check is worth', () => {
        const rows = reportRows([result('hsts', 'fail', {}, 5), result('csp', 'pass')], true);
        expect(rows.find((row) => row.id === 'hsts')?.gain).toBeGreaterThan(0);
        expect(rows.find((row) => row.id === 'csp')?.gain).toBe(0);
    });

    it('ranks the worst status first', () => {
        expect(STATUS_RANK.fail).toBeLessThan(STATUS_RANK.warn);
        expect(STATUS_RANK.warn).toBeLessThan(STATUS_RANK.pass);
    });
});

describe('categories and fixes', () => {
    const rows = reportRows([result('hsts', 'fail', {}, 5), result('seo_title', 'warn', {}, 2.5), result('csp', 'pass'), result('cert_valid', 'fail', {}, 8)], true);

    it('keeps the rows of the chosen category, or all of them when none is chosen', () => {
        expect(rowsInCategory(rows, undefined)).toHaveLength(rows.length);
        const security = rowsInCategory(rows, 'security');
        expect(security.length).toBeGreaterThan(0);
        expect(security.every((row) => row.definition.category === 'security')).toBe(true);
        expect(security.length).toBeLessThan(rows.length);
    });

    it('leads with the biggest gain among the checks that need attention, and never with a gain of nothing', () => {
        const top = topFixes(rows, 3);
        expect(top).toHaveLength(3);
        expect(top.map((row) => row.gain)).toEqual(top.map((row) => row.gain).sort((x, y) => y - x));
        expect(top.every((row) => row.status === 'fail' || row.status === 'warn')).toBe(true);
        expect(top.every((row) => row.gain > 0)).toBe(true);
        expect(topFixes(rows, 1)).toHaveLength(1);
        expect(topFixes(reportRows([result('csp', 'pass')], true), 3)).toEqual([]);
    });
});

describe('why a check was not checked', () => {
    it('says why in words, and says the scan ended when there is no result at all', () => {
        const skipped = { ...result('hsts', 'pass'), status: 'skipped' as const, skippedReason: 'not_html' };
        expect(skippedReasonLabel(skipped, 'en')).toMatch(/web page/);
        expect(skippedReasonLabel(undefined, 'en')).toMatch(/ended/);
        expect(skippedReasonLabel({ ...skipped, skippedReason: 'something_new' }, 'en')).toMatch(/did not run/);
        expect(skippedReasonLabel({ ...skipped, skippedReason: 'consent_wall' }, 'en')).toMatch(/consent/);
        expect(skippedReasonLabel({ ...skipped, skippedReason: 'login_wall' }, 'en')).toMatch(/login page/);
        expect(skippedReasonLabel({ ...skipped, skippedReason: 'meta_refresh' }, 'en')).toMatch(/meta refresh/);
    });
});

describe('a site that blocked the scanner', () => {
    it('names the status the page was turned away with, and shows no gain for any fix', () => {
        const blocked = { ...result('http_status', 'pass', { status: 403 }), status: 'skipped' as const, skippedReason: 'blocked' };
        const results = [result('https_scheme', 'fail', {}, 5), blocked];
        expect(blockedStatus(results)).toBe(403);
        expect(blockedStatus([result('http_status', 'pass', { status: 200 })])).toBeNull();
        expect(reportRows(results, true).every((row) => row.gain === 0)).toBe(true);
    });
});

describe('filters', () => {
    const rows = reportRows([result('hsts', 'fail', {}, 5), result('coop', 'warn', {}, 0.5), result('csp', 'pass')], true);

    it('counts what needs review, everything, and what passed', () => {
        expect(filterCounts(rows)).toEqual({ review: 2, all: CHECKS.length, passed: 1 });
    });

    it('shows only the matching rows for each filter', () => {
        expect(rowsForFilter(rows, 'review').map((row) => row.id)).toEqual(['hsts', 'coop']);
        expect(rowsForFilter(rows, 'passed').map((row) => row.id)).toEqual(['csp']);
        expect(rowsForFilter(rows, 'all')).toHaveLength(CHECKS.length);
    });
});

describe('full-text match', () => {
    const rows = reportRows([result('hsts', 'pass', { present: true, value: 'max-age=63072000; includeSubDomains' }), result('coop', 'warn', { present: false }, 0.5)], true);
    const row = (id: string) => {
        const found = rows.find((candidate) => candidate.id === id);
        if (found === undefined) throw new Error(`no row ${id}`);
        return found;
    };

    it('matches the title, the id, the area, the status and the measured value, in any case', () => {
        expect(matchesQuery(row('hsts'), 'HSTS', 'en')).toBe(true);
        expect(matchesQuery(row('coop'), 'opener', 'en')).toBe(true);
        expect(matchesQuery(row('hsts'), 'security headers', 'en')).toBe(true);
        expect(matchesQuery(row('coop'), 'needs attention', 'en')).toBe(true);
        expect(matchesQuery(row('hsts'), 'includesubdomains', 'en')).toBe(true);
    });

    it('needs every word, in any order, and finds nothing for a word that is not there', () => {
        expect(matchesQuery(row('hsts'), 'passed hsts', 'en')).toBe(true);
        expect(matchesQuery(row('hsts'), 'hsts embedder', 'en')).toBe(false);
        expect(matchesQuery(row('hsts'), 'zzzz', 'en')).toBe(false);
    });

    it('matches everything for an empty query', () => {
        expect(matchesQuery(row('hsts'), '   ', 'en')).toBe(true);
    });
});

describe('JSON export', () => {
    it('is plain data: one object per check with its status and evidence, and no prose', () => {
        const rows = reportRows([result('hsts', 'fail', { present: false }, 5)], true);
        const parsed: { domain: string; score: number | null; checks: Array<{ id: string; status: string; evidence: Record<string, unknown> }> } = JSON.parse(reportAsJson('example.com', 40, rows));
        expect(parsed).toMatchObject({ domain: 'example.com', score: 40 });
        expect(parsed.checks).toHaveLength(CHECKS.length);
        expect(parsed.checks.find((check) => check.id === 'hsts')).toMatchObject({ status: 'fail', evidence: { present: false } });
    });
});

describe('report titles', () => {
    it.each([...CATEGORIES])('has a title for the category %s', (category) => expect(categoryTitle(category, 'en').length).toBeGreaterThan(1));
    it.each([...GROUPS])('has a title for the group %s', (group) => expect(groupTitle(group, 'en').length).toBeGreaterThan(1));
});

describe('table state', () => {
    it('drops a selection its filter no longer lists', () => {
        expect(selectionIn(['hsts', 'csp'], 'csp')).toBe('csp');
        expect(selectionIn(['hsts'], 'csp')).toBeUndefined();
        expect(selectionIn(['hsts'], undefined)).toBeUndefined();
    });
});

describe('findingOf', () => {
    it('gives every check of the registry its own words, in both languages', () => {
        for (const locale of ['en', 'cs'] as const) {
            for (const row of reportRows([], true)) {
                const finding = findingOf(row, locale);
                expect(finding.title, row.id).not.toBe(row.id);
                expect(finding.explanation, row.id).not.toBe('');
            }
        }
    });

    it('carries what the check measured, with an empty value as a dash', () => {
        const [row] = reportRows([result('hsts', 'warn', { value: 'max-age=60', note: '' })], true).filter((candidate) => candidate.id === 'hsts');
        expect(row === undefined ? [] : findingOf(row, 'en').evidence).toEqual([
            ['value', 'max-age=60'],
            ['note', '—'],
        ]);
    });
});

describe('gainText', () => {
    it('shows a gain with or without its unit, and a dash for nothing', () => {
        expect(gainText(3.5, 'en')).toBe('+3.5 HP');
        expect(gainText(3.5, 'en', false)).toBe('+3.5');
        expect(gainText(0, 'en')).toBe('—');
        expect(gainText(0, 'cs', false)).toBe('—');
    });
});
