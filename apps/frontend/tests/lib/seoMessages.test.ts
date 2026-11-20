import { describe, expect, it } from 'vitest';
import { seoHead } from '@lib/seo';
import { m } from '@paraglide/messages.js';

const LOCALES = ['en', 'cs'] as const;

const DESCRIPTIONS = [
    m.seo_home_description,
    m.seo_about_description,
    m.seo_blog_description,
    m.seo_methodology_description,
    m.seo_status_description,
    m.seo_privacy_description,
    m.seo_terms_description,
    m.seo_cookies_description,
    m.seo_accessibility_description,
    m.seo_website_owners_description,
];
const TITLES = [
    m.seo_home_title,
    m.seo_about_title,
    m.seo_blog_title,
    m.seo_methodology_title,
    m.seo_status_title,
    m.seo_privacy_title,
    m.seo_terms_title,
    m.seo_cookies_title,
    m.seo_accessibility_title,
    m.seo_website_owners_title,
];

describe('page titles and descriptions', () => {
    // Stricter than the scanner's 70–160, so a description is never thin.
    it.each(LOCALES)('keep every %s description within the snippet length', (locale) => {
        for (const description of DESCRIPTIONS) {
            const text = description({}, { locale });
            expect(text.length, text).toBeGreaterThanOrEqual(110);
            expect(text.length, text).toBeLessThanOrEqual(160);
        }
    });

    // The scanner's own `seo_title` bounds (packages/core seo-html.ts), applied to the full title with the brand suffix.
    it.each(LOCALES)('keep every %s rendered title within 30–60 characters, the brand named once', (locale) => {
        for (const title of TITLES) {
            const head = seoHead({ title: title({}, { locale }), description: 'x', path: `/${locale}` });
            const text = String(head.meta.find((tag) => 'title' in tag)?.title);
            expect(text.length, text).toBeGreaterThanOrEqual(30);
            expect(text.length, text).toBeLessThanOrEqual(60);
            expect(text.match(/sitehp\.app/gi)?.length, text).toBe(1);
        }
    });

    it('do not repeat a description between pages', () => {
        for (const locale of LOCALES) {
            const texts = DESCRIPTIONS.map((description) => description({}, { locale }));
            expect(new Set(texts).size).toBe(texts.length);
        }
    });
});
