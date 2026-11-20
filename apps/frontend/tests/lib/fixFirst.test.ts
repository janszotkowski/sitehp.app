import { CHECKS, type CheckResult } from '@sitehp.app/core';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FixFirst } from '@components/FixFirst';
import { reportRows, topFixes } from '@lib/reportModel';

const result = (checkId: string, status: CheckResult['status'], pointsLost: number): CheckResult => {
    const definition = CHECKS.find((check) => check.id === checkId);
    if (definition === undefined) throw new Error(`no check ${checkId}`);
    return { checkId, category: definition.category, layer: definition.layer, status, severity: definition.severity, effort: definition.effort, evidence: {}, pointsLost };
};

describe('FixFirst', () => {
    const rows = reportRows([result('hsts', 'fail', 5), result('seo_title', 'warn', 1.5), result('csp', 'pass', 0)], true);
    const render = (list: typeof rows) => renderToString(createElement(FixFirst, { rows: list, onOpen: () => undefined, locale: 'en' }));

    it('shows a card for each check with its status, name, first sentence and HP gain', () => {
        const html = render(topFixes(rows, 3));
        expect(html).toContain('Fix these first');
        expect(html.match(/<button/g)).toHaveLength(2);
        expect(html).toContain('HSTS');
        expect(html).not.toContain('Content Security Policy');
        expect(html).toMatch(/\+\d/);
    });

    it('renders nothing when there is nothing to fix', () => {
        expect(render([])).toBe('');
    });
});
