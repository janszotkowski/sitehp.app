import { BLOG_POSTS } from '../src/content/blog/posts.ts';

export const LOCALES = ['en', 'cs'] as const;

export type PublicPage = {
    path: string;
    locale: (typeof LOCALES)[number];
    /** The same page in the other languages (including itself), where it exists. */
    alternates: Partial<Record<(typeof LOCALES)[number], string>>;
    /** Day of the last substantive change. Omitted where unknown — better nothing than the build date. */
    lastmod?: string;
};

/**
 * Page suffixes that exist in every language. Add a public page here and it is
 * prerendered and listed in the sitemap; nothing else needs to change.
 * Reports (`/r/*`), the dashboard and error pages are deliberately absent.
 */
const SHARED_PAGES = ['', '/methodology', '/about', '/blog', '/privacy', '/terms', '/cookies', '/accessibility', '/website-owners'] as const;

/** Day the legal and policy pages last changed in substance. The one source for their sitemap `lastmod` and the date they show (`lib/legal.ts`). */
export const LEGAL_LASTMOD = '2026-11-03';

/** Day of the last substantive change of a page, where it is known. The methodology changes with the scoring model. */
export const PAGE_LASTMOD: Partial<Record<(typeof SHARED_PAGES)[number], string>> = {
    '/methodology': '2026-10-10',
    '/privacy': LEGAL_LASTMOD,
    '/terms': LEGAL_LASTMOD,
    '/cookies': LEGAL_LASTMOD,
    '/accessibility': LEGAL_LASTMOD,
    '/website-owners': LEGAL_LASTMOD,
};

/** Every public address of the site. The single source for prerender and the sitemap. */
export const getPublicPages = (): PublicPage[] => {
    const pages: PublicPage[] = [];

    for (const suffix of SHARED_PAGES) {
        const alternates = Object.fromEntries(LOCALES.map((locale) => [locale, `/${locale}${suffix}`]));
        const lastmod = PAGE_LASTMOD[suffix];
        for (const locale of LOCALES) pages.push({ path: `/${locale}${suffix}`, locale, alternates, ...(lastmod ? { lastmod } : {}) });
    }

    // A post exists only in the languages it is written in (`src/content/blog/<locale>`), and points only at those.
    for (const post of BLOG_POSTS) {
        const locales = LOCALES.filter((locale) => post.text[locale] !== undefined);
        const alternates = Object.fromEntries(locales.map((locale) => [locale, `/${locale}/blog/${post.slug}`]));
        for (const locale of locales) pages.push({ path: `/${locale}/blog/${post.slug}`, locale, alternates, lastmod: post.updated ?? post.published });
    }

    return pages;
};

/** The Markdown twin of a public page (`/en/about` → `/en/about.md`), for agents. */
export const markdownPath = (path: string): string => `${path}.md`;

/** TanStack Start prerender page entries: every public page and its Markdown twin. Add new public URLs in `getPublicPages`. */
export const getTanstackStartPages = () => {
    return getPublicPages().flatMap(({ path }) => [{ path }, { path: markdownPath(path) }]);
};
