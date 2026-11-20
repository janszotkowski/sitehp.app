import { REPORT_HEADERS } from '../src/lib/reportHeaders.ts';
import { securityHeaders } from '../src/lib/securityHeaders.ts';
import { LOCALES } from './pages.ts';

type RouteRules = Record<string, { headers: Record<string, string> }>;

/** Hashed build output (scripts, styles and the self-hosted fonts, which Vite emits under `/assets/`): a new build gets new names. */
const IMMUTABLE = { 'Cache-Control': 'public, max-age=31536000, immutable' };

/** Pages: always asked again, so a deploy shows at once; the answer is cheap while the page is unchanged (ETag). */
const HTML = { 'Cache-Control': 'public, max-age=0, must-revalidate' };

/**
 * Nitro route rules: the headers static files get (they never reach `src/server.ts`) and the cache policy. A route rule
 * header overrides the same header of a response rendered by `src/server.ts`, so nothing the server sets per response
 * may be here: the Content-Security-Policy (hashes of each page's scripts) is left out on purpose, and report pages get
 * their own Referrer-Policy back. Later and more specific rules win over `/**`.
 *
 * With indexing off (every environment but production) static files are kept out of the index too: `robots.txt`,
 * `llms.txt` and the sitemap cannot carry a meta tag.
 */
export const routeRules = (allowIndexing: boolean): RouteRules => ({
    '/**': { headers: { ...securityHeaders(), ...(allowIndexing ? {} : { 'X-Robots-Tag': 'noindex, nofollow' }) } },
    '/assets/**': { headers: IMMUTABLE },
    ...Object.fromEntries(
        LOCALES.flatMap((locale) => [
            // `/en/**` does not match the bare language root.
            [`/${locale}`, { headers: HTML }],
            [`/${locale}/**`, { headers: HTML }],
            [`/${locale}/r/**`, { headers: { ...REPORT_HEADERS } }],
        ]),
    ),
});

/**
 * Nitro options for the production build only. The dev server gets none: Vite serves the files itself, and long-lived
 * caching or HSTS on localhost would only get in the way.
 */
export const nitroServerOptions = (command: 'build' | 'serve', allowIndexing: boolean) =>
    command === 'build' ? { routeRules: routeRules(allowIndexing), compressPublicAssets: { gzip: true, brotli: true } } : {};
