import { describe, expect, it } from 'vitest';
import { LEGAL_PAGES, legalDocument } from '@lib/legal';
import { LEGAL_LASTMOD, getPublicPages, getTanstackStartPages } from '@vite/pages';

describe('getTanstackStartPages', () => {
    it('lists every public locale URL and its Markdown twin exactly once', () => {
        const paths = getTanstackStartPages()
            .map((page) => page.path)
            .sort();
        const suffixes = ['', '/about', '/accessibility', '/blog', '/blog/how-sitehp-app-works', '/cookies', '/methodology', '/privacy', '/terms', '/website-owners'];
        expect(paths).toEqual(['en', 'cs'].flatMap((locale) => suffixes.flatMap((suffix) => [`/${locale}${suffix}`, `/${locale}${suffix}.md`])).sort());
    });

    it('never lists a private or generated area', () => {
        for (const { path } of getTanstackStartPages()) {
            expect(path).not.toMatch(/\/(r|dashboard|account)(\/|$)/);
        }
    });
});

describe('getPublicPages', () => {
    it('dates only the pages whose last change is known', () => {
        const dated = getPublicPages().filter((page) => page.lastmod !== undefined);
        const suffixes = ['/methodology', '/privacy', '/terms', '/cookies', '/accessibility', '/website-owners'];
        expect(dated.map((page) => page.path).sort()).toEqual(['en', 'cs'].flatMap((locale) => [...suffixes.map((suffix) => `/${locale}${suffix}`), `/${locale}/blog/how-sitehp-app-works`]).sort());
        for (const page of dated) expect(page.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('dates the legal pages with the day they show, from one source', () => {
        for (const locale of ['en', 'cs'] as const) {
            for (const id of LEGAL_PAGES) expect(getPublicPages().find((page) => page.path === `/${locale}/${id}`)?.lastmod, id).toBe(legalDocument(locale, id).updated);
        }
        expect(legalDocument('en', 'terms').updated).toBe(LEGAL_LASTMOD);
    });
});
