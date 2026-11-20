import { normalizeUrl, type FetchedPage } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { probeSite } from '@modules/scans/application/site-probes.ts';
import type { SiteFetcher } from '@modules/scans/ports.ts';
import { cannedPage } from '@tests/helpers.ts';

const target = (input: string) => {
    const result = normalizeUrl(input);
    if (!result.ok) throw new Error(result.reason);
    return result.url;
};

/** A fetcher that answers by address from a table; an address that is not in it does not answer. */
const tableFetcher = (answers: Record<string, Partial<FetchedPage>>): SiteFetcher & { requested: string[] } => {
    const requested: string[] = [];
    return {
        requested,
        fetchPage: (url, options) => {
            requested.push(url);
            const answer = (options?.accept === undefined ? undefined : answers[`${url} [${options.accept}]`]) ?? answers[url] ?? (url.includes('/sitehp-check-') ? { status: 404 } : undefined);
            return Promise.resolve(answer === undefined ? { ok: false, reason: 'unreachable' } : { ok: true, page: cannedPage({ finalUrl: url, ...answer }) });
        },
        inspectCertificate: () => Promise.resolve(null),
        close: () => Promise.resolve(),
    };
};

describe('probeSite', () => {
    it('keeps every side probe on the scanned site, and lets only the Markdown version of the page redirect anywhere, as the page does', async () => {
        const asked: Array<[string, boolean | undefined]> = [];
        const base = tableFetcher({});
        const fetcher: SiteFetcher = { ...base, fetchPage: (url, options) => (asked.push([url, options?.stayOnSite]), base.fetchPage(url, options)) };
        await probeSite(fetcher, target('https://example.com/page'));
        expect(asked.filter(([, stay]) => stay !== true)).toEqual([['https://example.com/page', false]]);
        expect(asked.map(([url]) => url)).toEqual(
            expect.arrayContaining(['https://example.com/robots.txt', 'https://example.com/llms.txt', 'https://example.com/sitemap.xml', 'https://www.example.com/']),
        );
    });

    it('fetches a few scripts and stylesheets of the page itself and keeps only how they were sent', async () => {
        const body = '<link rel="stylesheet" href="/a.css"><script src="/b.js"></script><script src="https://cdn.other.test/c.js"></script>';
        const fetcher = tableFetcher({
            'https://example.com/a.css': {
                contentType: 'text/css',
                headers: { 'content-encoding': 'br', 'cache-control': 'max-age=31536000, immutable', etag: '"abc"' },
                bytes: 9000,
                transferredBytes: 2000,
                body: 'secret-body',
            },
            'https://example.com/b.js': { contentType: 'text/javascript', headers: {}, bytes: 5000, transferredBytes: 5000 },
        });
        const page = cannedPage({ finalUrl: 'https://example.com/', body });
        const probes = await probeSite(fetcher, target('https://example.com'), { page });
        expect(probes.assetSample).toEqual([
            {
                url: 'https://example.com/a.css',
                status: 200,
                contentType: 'text/css',
                contentEncoding: 'br',
                cacheControl: 'max-age=31536000, immutable',
                etag: '"abc"',
                lastModified: null,
                bytes: 9000,
                transferredBytes: 2000,
            },
            {
                url: 'https://example.com/b.js',
                status: 200,
                contentType: 'text/javascript',
                contentEncoding: null,
                cacheControl: null,
                etag: null,
                lastModified: null,
                bytes: 5000,
                transferredBytes: 5000,
            },
        ]);
        expect(fetcher.requested.some((url) => url.includes('other.test'))).toBe(false);
        expect((await probeSite(fetcher, target('https://example.com'))).assetSample).toEqual([]);
    });

    it('follows the sitemap robots.txt names and samples its pages on the scanned host only', async () => {
        const pages = Array.from({ length: 6 }, (_unused, index) => `<url><loc>https://example.com/p${index}</loc></url>`).join('');
        const fetcher = tableFetcher({
            'https://example.com/robots.txt': { contentType: 'text/plain', body: 'Sitemap: https://example.com/map.xml\nSitemap: https://elsewhere.test/other.xml' },
            'https://example.com/map.xml': { contentType: 'application/xml', body: `<urlset><url><loc>https://elsewhere.test/x</loc></url>${pages}</urlset>` },
            'https://example.com/p0': { status: 200 },
            'https://example.com/p3': { status: 404 },
            'https://www.example.com/': { finalUrl: 'https://example.com/' },
        });
        const probes = await probeSite(fetcher, target('https://example.com'));
        expect(probes.sitemap).toMatchObject({ url: 'https://example.com/map.xml', status: 200 });
        // First, middle and last of the own-host addresses; the foreign one is never fetched. p5 is not in the table, so it does not answer.
        expect(probes.sitemapSample).toMatchObject([
            { url: 'https://example.com/p0', status: 200, redirected: false },
            { url: 'https://example.com/p3', status: 404, redirected: false },
            { url: 'https://example.com/p5', status: 0, redirected: false },
        ]);
        expect(fetcher.requested.some((url) => url.includes('elsewhere.test'))).toBe(false);
        expect(probes.hostVariant).toMatchObject({ finalUrl: 'https://example.com/' });
        expect(probes.notFound).toMatchObject({ status: 404 });
    });

    it('looks the files up on the site the page ended on, and on the typed one when the page left the site', async () => {
        const fetcher = tableFetcher({ 'https://www.example.com/robots.txt': { contentType: 'text/plain', body: 'User-agent: *\nAllow: /' } });
        const probes = await probeSite(fetcher, target('http://example.com'), { finalUrl: 'https://www.example.com/' });
        expect(probes.robots).toMatchObject({ url: 'https://www.example.com/robots.txt', status: 200 });
        expect(fetcher.requested).toEqual(expect.arrayContaining(['https://www.example.com/llms.txt', 'https://www.example.com/sitemap.xml', 'https://example.com/', 'http://example.com/']));
        expect(probes.notFound?.url).toMatch(/^https:\/\/www\.example\.com\/sitehp-check-/);

        const elsewhere = tableFetcher({});
        await probeSite(elsewhere, target('http://example.com'), { finalUrl: 'https://other.test/' });
        expect(elsewhere.requested).toEqual(expect.arrayContaining(['http://example.com/robots.txt', 'http://example.com/sitemap.xml']));
        expect(elsewhere.requested.some((url) => url.includes('other.test'))).toBe(false);
    });

    it('falls back to /sitemap.xml and, for an index of sitemaps, samples the pages of its first sitemap', async () => {
        const fetcher = tableFetcher({
            'https://example.com/robots.txt': { status: 404 },
            'https://example.com/sitemap.xml': {
                contentType: 'application/xml',
                body: '<sitemapindex><sitemap><loc>https://elsewhere.test/x.xml</loc></sitemap><sitemap><loc>https://example.com/a.xml</loc></sitemap><sitemap><loc>https://example.com/b.xml</loc></sitemap></sitemapindex>',
            },
            'https://example.com/a.xml': { contentType: 'application/xml', body: '<urlset><url><loc>https://example.com/one</loc></url></urlset>' },
            'https://example.com/one': { status: 200 },
        });
        const probes = await probeSite(fetcher, target('https://example.com'));
        expect(probes.sitemap).toMatchObject({ url: 'https://example.com/sitemap.xml' });
        expect(probes.sitemapSample).toEqual([{ url: 'https://example.com/one', status: 200, redirected: false, noindex: false, canonical: 'https://example.com/' }]);
        // Only the first sitemap of this site is opened, and never one on another site.
        expect(fetcher.requested).not.toContain('https://example.com/b.xml');
        expect(fetcher.requested.some((url) => url.includes('elsewhere.test'))).toBe(false);
    });

    it('marks a sampled page that answered through a redirect', async () => {
        const fetcher = tableFetcher({
            'https://example.com/robots.txt': { status: 404 },
            'https://example.com/sitemap.xml': { contentType: 'application/xml', body: '<urlset><url><loc>https://example.com/old</loc></url></urlset>' },
            'https://example.com/old': { finalUrl: 'https://example.com/new', redirects: [{ from: 'https://example.com/old', to: 'https://example.com/new', status: 301 }] },
        });
        const probes = await probeSite(fetcher, target('https://example.com'));
        expect(probes.sitemapSample).toMatchObject([{ url: 'https://example.com/old', status: 200, redirected: true }]);
    });

    it('reads a sitemap that robots.txt names on the www form of the scanned name', async () => {
        const fetcher = tableFetcher({
            'https://example.com/robots.txt': { contentType: 'text/plain', body: 'Sitemap: https://www.example.com/map.xml' },
            'https://www.example.com/map.xml': { contentType: 'application/xml', body: '<urlset><url><loc>https://www.example.com/page</loc></url></urlset>' },
            'https://www.example.com/page': { status: 200 },
        });
        const probes = await probeSite(fetcher, target('https://example.com'));
        expect(probes.sitemap).toMatchObject({ url: 'https://www.example.com/map.xml', status: 200 });
        expect(probes.sitemapSample).toMatchObject([{ url: 'https://www.example.com/page', status: 200, redirected: false }]);
    });

    it('reports what did not answer as null and tries no other name for a subdomain', async () => {
        const probes = await probeSite(tableFetcher({}), target('https://shop.example.com'));
        expect(probes).toMatchObject({ robots: null, sitemap: null, sitemapSample: [], notFound: { status: 404 } });
        expect('hostVariant' in probes).toBe(false);
    });

    it('makes up a different missing path every time', async () => {
        const first = tableFetcher({});
        const second = tableFetcher({});
        await probeSite(first, target('https://example.com'));
        await probeSite(second, target('https://example.com'));
        const missing = (fetcher: { requested: string[] }) => fetcher.requested.find((url) => url.includes('/sitehp-check-'));
        expect(missing(first)).toBeDefined();
        expect(missing(first)).not.toBe(missing(second));
    });
});

describe('probeSite: what an agent reads', () => {
    it('looks up llms.txt and asks for the page as Markdown, keeping the Vary header', async () => {
        const fetcher = tableFetcher({
            'https://example.com/llms.txt': { contentType: 'text/markdown', body: '# Example' },
            'https://example.com/ [text/markdown, text/html;q=0.5]': { contentType: 'text/markdown', headers: { vary: 'Accept', link: '</llms.txt>; rel="describedby"' }, body: '# Home' },
            'https://example.com/': { contentType: 'text/html', body: '<html></html>' },
        });
        const probes = await probeSite(fetcher, target('https://example.com'));
        expect(probes.llms).toMatchObject({ url: 'https://example.com/llms.txt', status: 200, contentType: 'text/markdown' });
        expect(probes.markdown).toMatchObject({ url: 'https://example.com/', contentType: 'text/markdown', vary: 'Accept', link: '</llms.txt>; rel="describedby"' });
    });

    it('leaves both null when nothing answers, and vary null when the site sends none', async () => {
        const none = await probeSite(tableFetcher({}), target('https://example.com'));
        expect(none.llms).toBeNull();
        expect(none.markdown).toBeNull();
        const plain = await probeSite(tableFetcher({ 'https://example.com/': { body: '<html></html>' } }), target('https://example.com'));
        expect(plain.markdown).toMatchObject({ vary: null });
    });
});

describe('probeSite: the well-known files an agent looks for', () => {
    it('fetches each of them on the scanned site and keeps null for one that did not answer', async () => {
        const fetcher = tableFetcher({
            'https://example.com/.well-known/api-catalog': { contentType: 'application/linkset+json', body: '{"linkset": []}' },
            'https://example.com/.well-known/agent-card.json': { status: 404 },
        });
        const probes = await probeSite(fetcher, target('https://example.com'));
        expect(Object.keys(probes.agentFiles).sort()).toEqual(['/.well-known/agent-card.json', '/.well-known/api-catalog', '/.well-known/oauth-protected-resource']);
        expect(probes.agentFiles['/.well-known/api-catalog']).toMatchObject({ status: 200, contentType: 'application/linkset+json', body: '{"linkset": []}' });
        expect(probes.agentFiles['/.well-known/agent-card.json']).toMatchObject({ status: 404 });
        expect(probes.agentFiles['/.well-known/oauth-protected-resource']).toBeNull();
    });
});
