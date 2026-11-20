import { OPERATOR } from '@config/operator';
import { parseArticle, type Article } from '@lib/article';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';
import { LEGAL_LASTMOD } from '@vite/pages';

/**
 * The legal and policy pages: Markdown in `src/content/legal/<locale>/<id>.md`, drawn like a blog post (`LegalPage`), with
 * `## Heading {#anchor}` so every section keeps its anchor in every language. The facts in them come from the code: what is
 * stored and for how long (`apps/backend/src/config/env.ts`), what the scanner sends (`site-fetcher.ts`, `site-probes.ts`) and
 * what the browser keeps (`lib/theme.ts`, and the router's scroll restoration in `router.tsx`). Change a fact there and here together.
 * The operator's details are `{{placeholders}}` filled from `config/operator.ts`.
 * The texts are a careful first draft; have them reviewed by a lawyer before the public launch.
 */
export type LegalPageId = 'privacy' | 'terms' | 'cookies' | 'accessibility' | 'website-owners';

export const LEGAL_PAGES: readonly LegalPageId[] = ['privacy', 'terms', 'cookies', 'accessibility', 'website-owners'];

export type LegalDocument = Article & {
    title: string;
    description: string;
    /** The day the text last changed in substance (YYYY-MM-DD). The same date as the sitemap's `lastmod` for these pages. */
    updated: string;
};

type Message = (inputs: Record<string, never>, options: { locale: Locale }) => string;

const HEADINGS: Record<LegalPageId, { title: Message; description: Message }> = {
    privacy: { title: m.seo_privacy_title, description: m.seo_privacy_description },
    terms: { title: m.seo_terms_title, description: m.seo_terms_description },
    cookies: { title: m.seo_cookies_title, description: m.seo_cookies_description },
    accessibility: { title: m.seo_accessibility_title, description: m.seo_accessibility_description },
    'website-owners': { title: m.seo_website_owners_title, description: m.seo_website_owners_description },
};

/** What the scanner calls itself in every request (`SCANNER_USER_AGENT` in the backend). */
export const SCANNER_USER_AGENT = 'sitehp.app-scanner/1.0 (+https://sitehp.app)';

const placeholders = (): Record<string, string> => ({
    controller: OPERATOR.name,
    contact: `[X](${OPERATOR.x})`,
    userAgent: SCANNER_USER_AGENT,
});

/** The Markdown of every page, by `<locale>/<id>`. */
const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(import.meta.glob<string>('/src/content/legal/*/*.md', { query: '?raw', import: 'default', eager: true })).map(([file, source]) => [
        file.slice('/src/content/legal/'.length, -'.md'.length),
        source,
    ]),
);

/** The text of a page with its placeholders filled. An unknown placeholder fails loudly rather than reaching the page. */
export const legalSource = (locale: Locale, id: LegalPageId): string => {
    const values = placeholders();
    return (SOURCES[`${locale}/${id}`] ?? '').replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
        const value = values[name];
        if (value === undefined) throw new Error(`Unknown placeholder {{${name}}} in ${locale}/${id}.md`);
        return value;
    });
};

export const legalDocument = (locale: Locale, id: LegalPageId): LegalDocument => ({
    ...parseArticle(legalSource(locale, id)),
    title: HEADINGS[id].title({}, { locale }),
    description: HEADINGS[id].description({}, { locale }),
    updated: LEGAL_LASTMOD,
});

/** The address of a legal page under its locale, e.g. `/en/privacy`. */
export const legalPath = (locale: Locale, id: LegalPageId): string => `/${locale}/${id}`;
