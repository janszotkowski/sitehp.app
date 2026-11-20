import type { Plugin } from 'vite';
import { DEFAULT_SITE_ORIGIN } from '../src/config/origin.ts';
import { getPublicPages, type PublicPage } from './pages.ts';

const ORIGIN = (process.env.VITE_SITE_URL ?? DEFAULT_SITE_ORIGIN).replace(/\/$/, '');

const escapeXml = (value: string): string => {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
};

const entry = (page: PublicPage, origin: string): string => {
    // The same rule as the HTML head: alternates only when the page really exists in more than one language.
    const alternates = Object.entries(page.alternates);
    const fallback = page.alternates.en;
    const links =
        alternates.length > 1
            ? [
                  ...alternates.map(([locale, path]) => `<xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(origin + path)}"/>`),
                  ...(fallback ? [`<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(origin + fallback)}"/>`] : []),
              ]
            : [];

    return ['<url>', `<loc>${escapeXml(origin + page.path)}</loc>`, ...(page.lastmod ? [`<lastmod>${page.lastmod}</lastmod>`] : []), ...links, '</url>'].join('');
};

/**
 * The sitemap is built from the same list of pages as the prerender. It has no
 * `priority` or `changefreq` (Google ignores them) and `lastmod` only where the
 * date of the change is really known.
 */
export const buildSitemap = (pages: readonly PublicPage[] = getPublicPages(), origin: string = ORIGIN): string => {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${pages.map((page) => entry(page, origin)).join('\n')}\n</urlset>\n`;
};

/**
 * The sitemap is emitted as part of the client build, not after it: the
 * generator built into TanStack Start wrote it after Nitro had assembled the
 * list of public files, so `/sitemap.xml` got the home page's HTML.
 */
export const sitemapPlugin = (): Plugin => {
    return {
        name: 'sitehp-sitemap',
        applyToEnvironment: (environment) => environment.name === 'client',
        generateBundle() {
            this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: buildSitemap() });
        },
        configureServer(server) {
            server.middlewares.use('/sitemap.xml', (_request, response) => {
                response.setHeader('content-type', 'application/xml; charset=utf-8');
                response.end(buildSitemap());
            });
        },
    };
};
