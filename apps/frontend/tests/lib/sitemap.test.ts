import { describe, expect, it } from 'vitest';
import { buildSitemap } from '@vite/sitemap';

describe('buildSitemap', () => {
    const origin = 'https://sitehp.app';
    const xml = buildSitemap(
        [
            { path: '/en/pricing', locale: 'en', alternates: { en: '/en/pricing' } },
            { path: '/en/blog/a&b', locale: 'en', alternates: { en: '/en/blog/a&b' }, lastmod: '2026-10-05' },
        ],
        origin,
    );

    it('is an XML document that declares the xhtml namespace for alternates', () => {
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
        expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    });

    it('does not claim alternates for a page that has only one language, and escapes the address', () => {
        expect(xml).toContain('<loc>https://sitehp.app/en/blog/a&amp;b</loc>');
        expect(xml).not.toContain('hreflang');
    });

    it('lists language alternates and x-default once a page has several', () => {
        const multi = buildSitemap([{ path: '/en/pricing', locale: 'en', alternates: { en: '/en/pricing', de: '/de/pricing' } as never }], origin);
        expect(multi).toContain('hreflang="de" href="https://sitehp.app/de/pricing"');
        expect(multi).toContain('hreflang="x-default" href="https://sitehp.app/en/pricing"');
    });

    it('carries lastmod only where a date is known, and no priority or changefreq', () => {
        expect(xml).toContain('<lastmod>2026-10-05</lastmod>');
        expect(xml.match(/<lastmod>/g)).toHaveLength(1);
        expect(xml).not.toMatch(/priority|changefreq/);
    });
});
