import { DEFAULT_LOCALE } from './switchLocalePath';

/**
 * Redirects that must happen before the router sees the address:
 *
 * - `/` has no content of its own and always goes to the default language
 *   (English), whatever the browser asks for; the other language is one click
 *   away in the language switcher. Temporary (302), so the default can change.
 * - `/en/` and `/en/index.html` (the prerendered file's own name) are the same
 *   page as `/en`. A permanent redirect moves the value of links onto the
 *   canonical address; the router would only answer 307 or 404.
 */
export const redirectFor = (request: Request): Response | null => {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;

    if (url.pathname === '/') {
        return new Response(null, { status: 302, headers: { location: `/${DEFAULT_LOCALE}${url.search}` } });
    }

    if (url.pathname.length > 1 && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
        // Leading slashes are merged: `//example.com/` as a `Location` would be
        // an address without a scheme, i.e. a redirect to a foreign site.
        const trimmed = `/${url.pathname
            .replace(/\/index\.html$/, '')
            .replace(/^\/+/, '')
            .replace(/\/+$/, '')}`;
        return new Response(null, { status: 301, headers: { location: `${trimmed}${url.search}` } });
    }

    return null;
};
