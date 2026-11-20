import { describe, expect, it } from 'vitest';
import { CHECKS as CATALOG, catalogFor, normalizeSelection } from '@src/browser.ts';
import { CHECKS } from '@src/index.ts';

describe('the browser entry', () => {
    it('lists every check of the registry, in order, with the same metadata and no runner', () => {
        expect(CATALOG).toEqual(CHECKS.map(({ run: _run, ...meta }) => meta));
    });
});

describe('a choice of checks', () => {
    it('adds the checks that must always run and keeps registry order', () => {
        const { ids, unknown } = normalizeSelection(['seo_title', 'hsts']);
        expect(unknown).toEqual([]);
        expect(ids).toEqual(CATALOG.filter((check) => ['http_status', 'hsts', 'seo_title'].includes(check.id)).map((check) => check.id));
    });

    it('reports an unknown id and drops it', () => {
        expect(normalizeSelection(['hsts', 'not_a_check'])).toMatchObject({ unknown: ['not_a_check'] });
        expect(normalizeSelection(['hsts', 'not_a_check']).ids).not.toContain('not_a_check');
    });

    it('is no choice at all when it covers every check, and catalogFor then lists them all', () => {
        expect(normalizeSelection(CATALOG.map((check) => check.id)).ids).toBeUndefined();
        expect(catalogFor(undefined)).toBe(CATALOG);
        expect(catalogFor(['hsts']).map((check) => check.id)).toEqual(['hsts']);
    });
});
