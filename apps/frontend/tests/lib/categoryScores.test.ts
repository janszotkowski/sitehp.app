import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CategoryScores } from '@components/CategoryScores';

const render = (capped: boolean, selected?: 'security') =>
    renderToString(
        createElement(CategoryScores, {
            locale: 'en',
            selected,
            onSelect: () => undefined,
            breakdown: {
                score: capped ? 59 : 81,
                capped,
                cappedBy: capped ? ['cert_valid'] : [],
                categories: [
                    { category: 'security', score: 72, share: 0.5, checks: 15, total: 18 },
                    { category: 'seo', score: 90, share: 0.375, checks: 20, total: 20 },
                    { category: 'agent', score: 100, share: 0.125, checks: 4, total: 4 },
                ],
            },
        }),
    );

describe('CategoryScores', () => {
    it('shows one ring per category with its score, share of the HP and how many of its checks ran', () => {
        const html = render(false);
        expect(html).toContain('aria-label="Security: 72 out of 100"');
        expect(html).toContain('aria-label="SEO: 90 out of 100"');
        expect(html).toContain('50 % of the HP · 15 of 18 checks ran');
        expect(html).toContain('13 % of the HP · 4 of 4 checks ran');
        expect(html).not.toContain('critical failure');
    });

    it('makes each category a button that says whether it narrows the checks below', () => {
        const html = render(false, 'security');
        expect(html.match(/<button[^>]*aria-pressed="true"/g)).toHaveLength(1);
        expect(html.match(/<button[^>]*aria-pressed="false"/g)).toHaveLength(2);
        expect(render(false)).not.toContain('aria-pressed="true"');
    });

    it('explains why the HP is lower than the categories when a critical failure caps it, naming the check', () => {
        expect(render(true)).toContain('Critical failure (Certificate): like poison in a game, it holds the HP at 59 at most');
    });
});
