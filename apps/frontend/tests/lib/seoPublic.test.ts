import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { originFile, withOrigin } from '@vite/originFiles';
import { getPublicPages } from '@vite/pages';
import { DEFAULT_SITE_ORIGIN } from '@config/origin';
import { methodology, plannedCategories } from '@lib/methodology';
import { categoryTitle } from '@lib/reportTitles';

describe('robots.txt', () => {
    const robots = readFileSync('vite/templates/robots.txt', 'utf8');

    it('lets search engines in and points them at the sitemap', () => {
        expect(robots).toContain('User-agent: *');
        expect(robots).toContain('Allow: /');
        expect(robots).toContain(`Sitemap: ${DEFAULT_SITE_ORIGIN}/sitemap.xml`);
    });

    it('lists only real sitemaps under Sitemap', () => {
        const sitemaps = robots.split('\n').filter((line) => line.startsWith('Sitemap:'));
        expect(sitemaps).toEqual([`Sitemap: ${DEFAULT_SITE_ORIGIN}/sitemap.xml`]);
    });

    it('does not block report pages, so social crawlers can still fetch their previews', () => {
        expect(robots).not.toMatch(/Disallow:\s*\/(en\/)?r(\/|$)/);
    });

    it('names the AI crawlers, each in a group that lets it in', () => {
        const groups = robots.split(/\n\s*\n/).map((group) => group.split('\n'));
        for (const agent of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
            const group = groups.find((lines) => lines.includes(`User-agent: ${agent}`));
            expect(group, agent).toContain('Allow: /');
            expect(group, agent).not.toContain('Disallow: /');
        }
    });

    it('repeats the content signal in every group that lets crawlers in, because a named group replaces `*`', () => {
        const groups = robots.split(/\n\s*\n/).map((group) => group.split('\n'));
        const open = groups.filter((lines) => lines.includes('Allow: /') && !lines.includes('Disallow: /'));
        expect(open.length).toBeGreaterThan(1);
        for (const lines of open) expect(lines).toContain('Content-Signal: ai-train=yes, search=yes, ai-input=yes');
    });

    it('uses only directives that crawlers and validators recognise', () => {
        const known = /^(user-agent|allow|disallow|sitemap|crawl-delay|content-signal):/i;
        const unknown = robots.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#') && !known.test(line));
        expect(unknown).toEqual([]);
    });
});

describe('llms.txt', () => {
    const llms = readFileSync('vite/templates/llms.txt', 'utf8');

    it('tells an assistant what this is', () => {
        expect(llms.startsWith('# sitehp.app')).toBe(true);
        expect(llms).toContain('HP score');
    });

    it('says when to use the product and when not to', () => {
        expect(llms).toMatch(/## When to use this/i);
        expect(llms).toContain('Do not use sitehp.app for');
    });

    it('lists every live category as live and every planned one as planned', () => {
        for (const { category } of methodology()) expect(llms).toContain(`- **${categoryTitle(category, 'en')}:**`);
        const planned = llms.slice(llms.indexOf('Planned, not available yet'));
        for (const category of plannedCategories()) expect(planned.toLowerCase()).toContain(categoryTitle(category, 'en').toLowerCase());
    });

    it('promises nothing the product does not do', () => {
        expect(llms).not.toMatch(/scan is not available|under construction/i);
    });

    it('links only to pages that exist on the site', () => {
        const links = [...llms.matchAll(/\]\((https:\/\/sitehp\.app[^)]*)\)/g)].map((match) => match[1]);
        for (const link of links) {
            // The public pages come from the one list that also feeds prerender and the sitemap.
            expect([...getPublicPages().map((page) => `${DEFAULT_SITE_ORIGIN}${page.path}`), `${DEFAULT_SITE_ORIGIN}/sitemap.xml`, `${DEFAULT_SITE_ORIGIN}/en/…`]).toContain(link);
        }
    });
});

describe('robots.txt and llms.txt of a build', () => {
    it('carry the origin of the build, so a staging build never publishes the production addresses', () => {
        const origin = 'https://staging.sitehp.app';
        for (const name of ['robots.txt', 'llms.txt'] as const) {
            const text = originFile(name, origin);
            expect(text, name).not.toContain(`${DEFAULT_SITE_ORIGIN}/`);
            expect(text, name).toContain(`${origin}/`);
        }
        expect(originFile('robots.txt', origin)).toContain(`Sitemap: ${origin}/sitemap.xml`);
    });

    it('leave the production files as they are for the production origin', () => {
        expect(withOrigin('Sitemap: https://sitehp.app/sitemap.xml', DEFAULT_SITE_ORIGIN)).toBe('Sitemap: https://sitehp.app/sitemap.xml');
    });
});
