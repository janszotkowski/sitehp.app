import handler from '@tanstack/react-start/server-entry';
import { ApiError } from '@sitehp.app/core/browser';
import { PUBLIC_API_URL } from '@config/api';
import { ALLOW_INDEXING, canonicalUrl } from '@config/site';
import { createApi } from '@lib/api';
import { redirectFor } from '@lib/i18n/negotiate';
import { DEFAULT_LOCALE } from '@lib/i18n/switchLocalePath';
import { badgeCacheControl, badgeReportIdOf, badgeStateOf, badgeSvg, badgeThemeOf, type BadgeState, type BadgeTheme } from '@lib/badge';
import { renderOgImage } from '@lib/ogImage';
import { createLru, ogCacheControl, ogCacheKey, ogReportIdOf } from '@lib/ogRoute';
import { compressed } from '@lib/compression';
import { REPORT_HEADERS, isReportPath } from '@lib/reportHeaders';
import { contentSecurityPolicy, documentPolicy, securityHeaders } from '@lib/securityHeaders';
import { htmlToMarkdown, markdownSourceOf, markdownTokens, markdownTwinOf, notFoundMarkdown, wantsMarkdown } from '@lib/seoMarkdown';
import { ogImagePath } from '@lib/seo';
import { paraglideMiddleware } from '@paraglide/server.js';

const SECURITY_HEADERS = securityHeaders();

const rewrite = (response: Response, change: (headers: Headers) => void): Response => {
    const headers = new Headers(response.headers);
    change(headers);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

// The `$locale` route param already carries the language in the URL path,
// so the original request goes through instead of the middleware's
// de-localized one (which would strip the `/en` prefix the router needs).
// The middleware still does its real job: it populates AsyncLocalStorage
// so getLocale() / m.*() resolve the right language during SSR.
const render = (request: Request): Promise<Response> => paraglideMiddleware(request, () => handler.fetch(request));

const markdownResponse = (markdown: string, status: number, headers: Record<string, string> = {}): Response =>
    new Response(markdown, {
        status,
        // The same address can answer HTML or Markdown (`Accept`), so a shared cache must keep them apart.
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'x-markdown-tokens': String(markdownTokens(markdown)), vary: 'Accept', ...headers },
    });

/**
 * A page as Markdown for agents, drawn from its own rendered HTML: the `.md` twin of a public page, or any page asked for
 * with `Accept: text/markdown`. The HTML page stays the canonical one. A missing page is a 404 in Markdown, not HTML.
 */
const renderMarkdown = async (request: Request, pagePath: string): Promise<Response> => {
    // The router answers 500 to an `Accept` it cannot serve, so the page is always asked for as HTML.
    const headers = new Headers(request.headers);
    headers.set('accept', 'text/html');
    const page = await render(new Request(new URL(pagePath, request.url), { headers }));
    if (page.status === 404) return markdownResponse(notFoundMarkdown(), 404);
    // A redirect or a server error is passed on as it is.
    if (page.status !== 200) return page;
    return markdownResponse(htmlToMarkdown(await page.text()), 200, { link: `<${canonicalUrl(pagePath)}>; rel="canonical"` });
};

/** Page requests that may be negotiated to Markdown: reads of an address, not calls of a server function. */
const negotiable = (request: Request, pathname: string): boolean =>
    (request.method === 'GET' || request.method === 'HEAD') && !pathname.startsWith('/_serverFn') && wantsMarkdown(request.headers.get('accept'));

/**
 * The headers only an HTML page gets: its Content-Security-Policy, built from the hashes of its own inline scripts (so
 * the whole body is read), `Vary: Accept` (the same address answers Markdown to agents) and, for a public page, a `Link`
 * to its Markdown twin so agents can find it.
 */
const withPageHeaders = async (response: Response, pathname: string): Promise<Response> => {
    const html = await response.text();
    const headers = new Headers(response.headers);
    const policy = documentPolicy(PUBLIC_API_URL, html, import.meta.env.PROD);
    if (policy !== undefined) headers.set('content-security-policy', policy);
    headers.append('vary', 'Accept');
    const twin = markdownTwinOf(pathname);
    if (twin !== undefined) headers.append('link', `<${canonicalUrl(twin)}>; rel="alternate"; type="text/markdown"`);
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
};

// Drawing a preview takes far longer than asking the API for the report, and a shared link is fetched by every app it is pasted into.
const ogImages = createLru<Uint8Array<ArrayBuffer>>(200);

/**
 * The share preview of a report, drawn from the report the API serves. An unknown report gets the site's default card,
 * and so does a failure to draw one (a broken preview must never break the share).
 */
const renderOgReport = async (request: Request, publicId: string): Promise<Response> => {
    const fallback = (cache: string) => new Response(null, { status: 302, headers: { location: new URL(ogImagePath(DEFAULT_LOCALE), request.url).href, 'cache-control': cache } });
    try {
        const snapshot = await createApi().getScan(publicId);
        const key = ogCacheKey(snapshot);
        let png = ogImages.get(key);
        if (png === undefined) {
            png = new Uint8Array(await renderOgImage(snapshot, DEFAULT_LOCALE));
            ogImages.set(key, png);
        }
        return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': ogCacheControl(snapshot.status) } });
    } catch (error) {
        if (error instanceof ApiError && error.code === 'NOT_FOUND') return fallback('public, max-age=300');
        console.error('share preview failed', error);
        return fallback('no-store');
    }
};

/**
 * The badge of a report, drawn from the report the API serves. It is an image other sites embed, so a report that is gone
 * (or never was) still answers with an image, a neutral "Expired", and so does a failure to read it; the picture is never a broken link.
 */
const renderBadgeReport = async (publicId: string, theme: BadgeTheme): Promise<Response> => {
    const answer = (state: BadgeState, status = 200) =>
        new Response(badgeSvg(state, theme), {
            status,
            // `noindex` always: a badge is an image to embed, not a page, and the report behind it is private.
            headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': badgeCacheControl(state), 'x-robots-tag': 'noindex, nofollow' },
        });
    try {
        return answer(badgeStateOf(await createApi().getScan(publicId)));
    } catch (error) {
        if (error instanceof ApiError && error.code === 'NOT_FOUND') return answer({ kind: 'expired' });
        console.error('badge failed', error);
        return answer({ kind: 'unavailable' }, 503);
    }
};

export default {
    async fetch(request: Request) {
        const redirect = redirectFor(request);
        if (redirect) return redirect;

        const { pathname } = new URL(request.url);
        const ogReportId = ogReportIdOf(pathname);
        const badgeReportId = badgeReportIdOf(pathname);
        const markdownSource = markdownSourceOf(pathname) ?? (negotiable(request, pathname) ? pathname : undefined);
        // A HEAD is rendered as a GET: the policy hashes and the token count need the body (Nitro drops it from the answer).
        const read = request.method === 'HEAD' ? new Request(request.url, { headers: request.headers }) : request;
        let response =
            badgeReportId !== undefined
                ? await renderBadgeReport(badgeReportId, badgeThemeOf(new URL(request.url).searchParams))
                : ogReportId !== undefined
                  ? await renderOgReport(read, ogReportId)
                  : markdownSource === undefined
                    ? await render(read)
                    : await renderMarkdown(read, markdownSource);

        if (response.headers.get('content-type')?.startsWith('text/html') === true) {
            response = await withPageHeaders(response, pathname);
        } else if (import.meta.env.PROD) {
            // Not a document, so no inline script to allow: the policy without hashes.
            response = rewrite(response, (headers) => headers.set('content-security-policy', contentSecurityPolicy(PUBLIC_API_URL)));
        }

        // The same headers the route rules put on static files (`vite/routeRules.ts`), for every rendered response: a
        // route rule does not reach an error page.
        response = rewrite(response, (headers) => {
            for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
        });

        // Report pages are reachable only by their link: never indexed, never leaking the address as a referrer.
        if (isReportPath(new URL(request.url).pathname)) {
            response = rewrite(response, (headers) => {
                for (const [name, value] of Object.entries(REPORT_HEADERS)) headers.set(name, value);
            });
        }

        // An error page does not belong in the index even if someone links to it,
        // and nothing on a non-production environment does. The header also
        // covers responses that are not HTML; static files get it from the
        // route rules (`vite/routeRules.ts`).
        if (!response.headers.has('x-robots-tag')) {
            if (!ALLOW_INDEXING) response = rewrite(response, (headers) => headers.set('x-robots-tag', 'noindex, nofollow'));
            else if (response.status === 404) response = rewrite(response, (headers) => headers.set('x-robots-tag', 'noindex'));
        }

        // Pages and Markdown are rendered here, past Nitro's compression of static files.
        return compressed(response, request.headers.get('accept-encoding'));
    },
};
