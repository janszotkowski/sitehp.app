import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@lib/i18n/switchLocalePath';
import { LEGAL_PAGES, SCANNER_USER_AGENT, legalDocument, legalSource } from '@lib/legal';
import { getPublicPages } from '@vite/pages';

describe('legal pages', () => {
    it.each(LOCALES.flatMap((locale) => LEGAL_PAGES.map((id) => [locale, id] as const)))('%s/%s has a title, a description, a date and sections with unique anchors', (locale, id) => {
        const document = legalDocument(locale, id);
        expect(document.title.length).toBeGreaterThan(3);
        expect(document.description.length).toBeGreaterThan(40);
        expect(document.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const ids = document.outline.map((heading) => heading.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThan(1);
        // Every section has a heading of its own and an explicit anchor; nothing is left unfilled.
        expect(document.document.children.filter((node) => node.type === 'heading' && node.depth === 1)).toEqual([]);
        expect(legalSource(locale, id)).not.toContain('{{');
        for (const heading of document.outline) expect(heading.text).not.toContain('{#');
    });

    it('are prerendered and listed in the sitemap', () => {
        const paths = getPublicPages().map((page) => page.path);
        for (const id of LEGAL_PAGES) expect(paths).toContain(`/en/${id}`);
    });

    it('name the user agent the scanner really sends', () => {
        const fetcher = readFileSync('../backend/src/modules/scans/infrastructure/site-fetcher.ts', 'utf8');
        expect(fetcher).toContain(`'${SCANNER_USER_AGENT}'`);
    });

    it('promise the 30-day report retention the backend keeps', () => {
        const env = readFileSync('../backend/src/config/env.ts', 'utf8');
        expect(env).toMatch(/SCAN_RETENTION_MS:[\s\S]*?\.default\(30 \* 86_400_000\)/);
        const thirtyDays: Record<string, string> = { en: '30 days', cs: '30 dnů' };
        for (const locale of LOCALES) {
            expect(legalSource(locale, 'privacy')).toContain(thirtyDays[locale]);
        }
    });
});

describe('security.txt', () => {
    const text = readFileSync('public/.well-known/security.txt', 'utf8');

    it('gives the contact and a policy (RFC 9116)', () => {
        expect(text).toMatch(/^Contact: https:\/\/x\.com\/janszotkowskix$/m);
        expect(text).toMatch(/^Policy: https:\/\/sitehp\.app\/en\/terms#security$/m);
    });

    it('has not expired, and is renewed at least a month before it does', () => {
        const expires = /^Expires: (.+)$/m.exec(text)?.[1];
        expect(expires).toBeDefined();
        expect(new Date(expires ?? '').getTime() - Date.now()).toBeGreaterThan(30 * 24 * 60 * 60 * 1000);
    });
});

describe('links in the legal pages', () => {
    it.each([...LOCALES])('%s: link the contact on X, the authority and the pages they name', (locale) => {
        const text = (id: (typeof LEGAL_PAGES)[number]) => legalSource(locale, id);
        expect(text('privacy')).toContain('(https://x.com/janszotkowskix)');
        expect(text('privacy')).toContain('(https://uoou.gov.cz)');
        expect(text('terms')).toContain(`(/${locale}/methodology)`);
        expect(text('terms')).toContain(`(/${locale}/website-owners)`);
        expect(text('terms')).toContain('(/.well-known/security.txt)');
    });

    it('keep the same sections in every language', () => {
        for (const id of LEGAL_PAGES) {
            const anchors = (locale: (typeof LOCALES)[number]) => legalDocument(locale, id).outline.map((heading) => heading.id);
            for (const locale of LOCALES) expect(anchors(locale)).toEqual(anchors('en'));
        }
    });
});
