import { parseArticle, type Article } from '@lib/article';
import { BLOG_POSTS, type BlogPostText } from '@src/content/blog/posts';
import { LOCALES, type Locale } from '@lib/i18n/switchLocalePath';

/** The Markdown of every post, by `<locale>/<slug>`. Bundled with the blog routes only (they are their own chunk). */
const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(import.meta.glob<string>('/src/content/blog/*/*.md', { query: '?raw', import: 'default', eager: true })).map(([file, source]) => [
        file.slice('/src/content/blog/'.length, -'.md'.length),
        source,
    ]),
);

/** A post in one language. */
export type BlogPostEntry = BlogPostText & {
    slug: string;
    published: string;
    updated?: string;
    /** The languages it is written in, for `hreflang`. */
    locales: Locale[];
};

export type BlogPost = BlogPostEntry & Article;

/** The posts written in `locale`, newest first. */
export const blogPosts = (locale: Locale): BlogPostEntry[] =>
    BLOG_POSTS.flatMap(({ slug, text, published, updated }) => {
        const own = text[locale];
        if (own === undefined) return [];
        return [{ slug, ...own, published, ...(updated === undefined ? {} : { updated }), locales: LOCALES.filter((candidate) => text[candidate] !== undefined) }];
    });

export const blogPath = (locale: string, slug?: string): string => (slug === undefined ? `/${locale}/blog` : `/${locale}/blog/${slug}`);

/** The same post in every language it is written in, for `alternates`. */
export const blogAlternates = (post: BlogPostEntry): Partial<Record<Locale, string>> => Object.fromEntries(post.locales.map((locale) => [locale, blogPath(locale, post.slug)]));

/** A post, parsed, or `undefined` when there is none by that slug in that language. The content is ours (no raw HTML allowed all the same). */
export const blogPost = (locale: Locale, slug: string): BlogPost | undefined => {
    const meta = blogPosts(locale).find((post) => post.slug === slug);
    const source = SOURCES[`${locale}/${slug}`];
    if (meta === undefined || source === undefined) return undefined;
    return { ...meta, ...parseArticle(source) };
};

/** The files that exist (`<locale>/<slug>`), for the test that keeps `posts.ts` and the Markdown in step. */
export const blogSourceKeys = (): string[] => Object.keys(SOURCES).sort();

export const blogSource = (locale: Locale, slug: string): string | undefined => SOURCES[`${locale}/${slug}`];
