import { renderHtml } from '@tanstack/markdown/html';
import { describe, expect, it } from 'vitest';
import { highlightCode } from '@lib/article';
import { blogPost, blogPosts, blogSource, blogSourceKeys } from '@lib/blog';
import { LOCALES } from '@lib/i18n/switchLocalePath';
import { seoHead } from '@lib/seo';
import { getPublicPages } from '@vite/pages';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

describe('blog posts', () => {
    const all = LOCALES.flatMap((locale) => blogPosts(locale).map((post) => ({ locale, post })));

    it('have one Markdown file per language they are written in, and no file without an entry in posts.ts', () => {
        expect(blogSourceKeys()).toEqual(all.map(({ locale, post }) => `${locale}/${post.slug}`).sort());
    });

    it('are listed newest first, with unique URL-safe slugs', () => {
        for (const locale of LOCALES) {
            const slugs = blogPosts(locale).map((post) => post.slug);
            expect(new Set(slugs).size).toBe(slugs.length);
            for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
            const dates = blogPosts(locale).map((post) => post.published);
            expect(dates).toEqual([...dates].sort().reverse());
        }
    });

    it.each(all.map(({ locale, post }) => [`${locale}/${post.slug}`, post] as const))('%s fits search results: title 30–60 with the brand once, description 110–160', (_, post) => {
        const head = seoHead({ title: post.title, description: post.description, path: '/en' });
        const title = String(head.meta.find((tag) => 'title' in tag)?.title);
        expect(title.length, title).toBeGreaterThanOrEqual(30);
        expect(title.length, title).toBeLessThanOrEqual(60);
        expect(title.match(/sitehp\.app/gi)?.length, title).toBe(1);
        expect(post.description.length, post.description).toBeGreaterThanOrEqual(110);
        expect(post.description.length, post.description).toBeLessThanOrEqual(160);
        expect(post.published).toMatch(DAY);
        if (post.updated !== undefined) expect(post.updated >= post.published).toBe(true);
    });

    it.each(all.map(({ locale, post }) => [`${locale}/${post.slug}`, locale, post.slug] as const))('%s starts its headings at ##: the title is the only <h1>', (_, locale, slug) => {
        expect(blogSource(locale, slug)).not.toMatch(/^# /m);
        expect(blogPost(locale, slug)?.document.children.some((node) => node.type === 'heading' && node.depth === 1)).toBe(false);
    });

    it.each(all.map(({ locale, post }) => [`${locale}/${post.slug}`, `/${locale}/blog/${post.slug}`] as const))('%s is prerendered and in the sitemap', (_, path) => {
        expect(getPublicPages().map((page) => page.path)).toContain(path);
    });

    it('links only to its own language', () => {
        for (const { locale, post } of all) {
            for (const [, href] of (blogSource(locale, post.slug) ?? '').matchAll(/\]\((\/[^)]*)\)/g)) expect(href, `${locale}/${post.slug}`).toMatch(new RegExp(`^/${locale}(/|$)`));
        }
    });

    it('is undefined for a slug that does not exist', () => {
        expect(blogPost('en', 'no-such-post')).toBeUndefined();
    });
});

// The HTML renderer of the same library: the React one (`ArticleBody`) is tested by the library for the same output, and needs a router for its links.
describe('a rendered post', () => {
    const post = blogPost('en', blogPosts('en')[0]?.slug ?? '');
    const render = () => renderHtml(post!.document, { highlighter: highlightCode });

    it('has an outline of its ## and ### headings, each pointing at a heading id in the body', () => {
        expect(post).toBeDefined();
        const html = render();
        expect(post!.outline.length).toBeGreaterThan(1);
        for (const heading of post!.outline) {
            expect([2, 3]).toContain(heading.level);
            expect(html).toContain(`id="${heading.id}"`);
        }
        const ids = post!.outline.map((heading) => heading.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('highlights code and never lets raw HTML through', () => {
        const html = render();
        expect(html).toContain('class="th-token');
        expect(html).not.toContain('<script');
    });
});
