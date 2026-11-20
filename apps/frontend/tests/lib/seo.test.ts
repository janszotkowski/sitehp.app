import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_ORIGIN, canonicalUrl } from '@config/site';
import { clip, seoHead } from '@lib/seo';

describe('seoHead', () => {
    it('appends the brand and emits Open Graph, Twitter and canonical', () => {
        const head = seoHead({ title: 'Pricing', description: 'Plans and add-ons.', path: '/en/pricing' });

        expect(head.meta).toContainEqual({ title: 'Pricing | sitehp.app' });
        expect(head.meta).toEqual(
            expect.arrayContaining([
                { name: 'description', content: 'Plans and add-ons.' },
                { name: 'robots', content: 'index, follow' },
                { property: 'og:title', content: 'Pricing | sitehp.app' },
                { property: 'og:url', content: `${SITE_ORIGIN}/en/pricing` },
                { property: 'og:image', content: `${SITE_ORIGIN}/og/en.png` },
                { property: 'og:locale', content: 'en_US' },
                { property: 'og:site_name', content: 'sitehp.app' },
                { name: 'twitter:card', content: 'summary_large_image' },
            ]),
        );
        expect(head.links).toEqual(
            expect.arrayContaining([
                { rel: 'canonical', href: `${SITE_ORIGIN}/en/pricing` },
                { rel: 'alternate', hrefLang: 'en', href: `${SITE_ORIGIN}/en/pricing` },
                { rel: 'alternate', hrefLang: 'cs', href: `${SITE_ORIGIN}/cs/pricing` },
                { rel: 'alternate', hrefLang: 'x-default', href: `${SITE_ORIGIN}/en/pricing` },
            ]),
        );
        expect(head.meta).toContainEqual({ property: 'og:locale:alternate', content: 'cs_CZ' });
    });

    it('describes a Czech page in Czech terms, with the Czech image', () => {
        const head = seoHead({ title: 'Ceník', description: 'x', path: '/cs/pricing' });
        expect(head.meta).toEqual(
            expect.arrayContaining([
                { property: 'og:locale', content: 'cs_CZ' },
                { property: 'og:image', content: `${SITE_ORIGIN}/og/cs.png` },
                { property: 'og:locale:alternate', content: 'en_US' },
            ]),
        );
    });

    it('does not repeat the brand when the title already ends with it', () => {
        const head = seoHead({ title: 'Pricing | sitehp.app', description: 'x', path: '/en/pricing' });
        expect(head.meta).toContainEqual({ title: 'Pricing | sitehp.app' });
    });

    it('keeps a page out of the index on request', () => {
        const head = seoHead({ title: 'Report', description: 'x', path: '/en/r/abc', noindex: true });
        expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' });
    });

    it('serialises JSON-LD when a schema is provided', () => {
        const schema = { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Pricing' };
        const head = seoHead({ title: 'Pricing', description: 'x', path: '/en/pricing', schema });
        expect(head.scripts).toEqual([{ type: 'application/ld+json', children: JSON.stringify(schema) }]);
    });

    it('escapes a closing tag inside JSON-LD', () => {
        const head = seoHead({ title: 'Pricing', description: 'x', path: '/en/pricing', schema: { name: '</script><b>' } });
        expect(head.scripts[0]?.children).not.toContain('</script>');
    });
});

describe('seoHead when indexing is not allowed', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('marks every page noindex, whatever the page asks for', async () => {
        vi.stubEnv('VITE_ALLOW_INDEXING', 'false');
        vi.resetModules();
        const { seoHead: guarded } = await import('@lib/seo');
        const head = guarded({ title: 'Pricing', description: 'x', path: '/en/pricing' });
        expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' });
    });
});

describe('canonicalUrl', () => {
    it('joins a path onto the origin', () => {
        expect(canonicalUrl('/en/pricing')).toBe(`${SITE_ORIGIN}/en/pricing`);
        expect(canonicalUrl('')).toBe(SITE_ORIGIN);
    });
});

describe('clip', () => {
    it('keeps a short value as it is', () => {
        expect(clip('example.com', 46)).toBe('example.com');
    });

    it('cuts a long value to the limit, ellipsis included, without splitting a character', () => {
        const long = `${'a'.repeat(60)}.com`;
        expect(clip(long, 46)).toBe(`${'a'.repeat(45)}…`);
        expect(Array.from(clip('ü'.repeat(10), 5))).toHaveLength(5);
    });
});
