/**
 * Every blog post, newest first. The body of each language is `<locale>/<slug>.md` next to this file (Markdown, starting at `##`: the
 * title is the page's `<h1>`). Plain data with no imports, so `vite/pages.ts` can read it for the prerender and the sitemap. Add a post
 * here and write its files; `tests/lib/blog.test.ts` checks that the two agree and that the title and description fit search results.
 */
export type BlogPostText = {
    /** At most 47 characters: the page title adds ` | sitehp.app`. */
    title: string;
    /** 110–160 characters: the search-result snippet and the line under the title in the list. */
    description: string;
};

export type BlogPostMeta = {
    slug: string;
    /** The languages the post is written in. A language without an entry has no such post (and no `hreflang` to it). */
    text: { en?: BlogPostText; cs?: BlogPostText };
    /** `YYYY-MM-DD`. */
    published: string;
    /** `YYYY-MM-DD` of the last change in substance, when there was one. */
    updated?: string;
};

export const BLOG_POSTS: readonly BlogPostMeta[] = [
    {
        slug: 'how-sitehp-app-works',
        text: {
            en: {
                title: 'How the scanner works, from URL to score',
                description: 'What happens between typing an address and reading the report: the checks, the queue, the score and the rules that keep the scanner safe.',
            },
            cs: {
                title: 'Jak skener funguje, od adresy ke skóre',
                description: 'Co se děje mezi zadáním adresy a přečtením reportu: kontroly, fronta, výpočet skóre a pravidla, která udržují skener v bezpečí.',
            },
        },
        published: '2026-10-16',
    },
];
