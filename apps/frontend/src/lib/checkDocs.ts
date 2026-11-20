/** A page that explains a check in depth, outside this site. */
export type DocLink = { source: string; title: string; url: string };

const MDN = 'MDN Web Docs';
const GOOGLE = 'Google Search Central';
const MDN_HEADER = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers';
const MDN_HTML = 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference';
const GOOGLE_CRAWL = 'https://developers.google.com/search/docs/crawling-indexing';

const mdn = (title: string, url: string): DocLink => ({ source: MDN, title, url });
const google = (title: string, url: string): DocLink => ({ source: GOOGLE, title, url });

/**
 * Where to read more about a check, by `checkId`: the web platform's own documentation (MDN) for headers, cookies
 * and markup, and the search engine's (Google) for what decides how a page is found and shown. Addresses were
 * checked when they were added; a check without an entry shows no "Learn more" (the explanation stands on its own).
 * A test keeps every address on https and on a source named here.
 */
export const checkDocs: Record<string, readonly DocLink[]> = {
    https_scheme: [mdn('HTTPS', 'https://developer.mozilla.org/en-US/docs/Glossary/HTTPS')],
    http_redirect: [mdn('Redirections in HTTP', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Redirections')],
    cert_valid: [{ source: "Let's Encrypt", title: 'Documentation', url: 'https://letsencrypt.org/docs/' }],
    cert_expiry: [{ source: "Let's Encrypt", title: 'Documentation', url: 'https://letsencrypt.org/docs/' }],
    ttfb: [{ source: 'web.dev', title: 'Time to First Byte', url: 'https://web.dev/articles/ttfb' }],
    compression: [mdn('Compression in HTTP', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression')],
    cache_headers: [mdn('HTTP caching', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching')],
    http_version: [mdn('Evolution of HTTP', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Evolution_of_HTTP')],
    page_weight: [{ source: 'web.dev', title: 'Total byte weight', url: 'https://developer.chrome.com/docs/lighthouse/performance/total-byte-weight' }],
    render_blocking: [{ source: 'web.dev', title: 'Eliminate render-blocking resources', url: 'https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources' }],
    image_formats: [{ source: 'web.dev', title: 'Serve images in modern formats', url: 'https://developer.chrome.com/docs/lighthouse/performance/uses-webp-images' }],
    lazy_loading: [mdn('Lazy loading', 'https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Lazy_loading')],
    hsts: [mdn('Strict-Transport-Security', `${MDN_HEADER}/Strict-Transport-Security`)],
    csp: [mdn('Content Security Policy', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP')],
    x_frame_options: [mdn('X-Frame-Options', `${MDN_HEADER}/X-Frame-Options`)],
    x_content_type_options: [mdn('X-Content-Type-Options', `${MDN_HEADER}/X-Content-Type-Options`)],
    referrer_policy: [mdn('Referrer-Policy', `${MDN_HEADER}/Referrer-Policy`)],
    permissions_policy: [mdn('Permissions-Policy', `${MDN_HEADER}/Permissions-Policy`)],
    coop: [mdn('Cross-Origin-Opener-Policy', `${MDN_HEADER}/Cross-Origin-Opener-Policy`)],
    info_leak: [mdn('Server header', `${MDN_HEADER}/Server`)],
    cookie_secure: [mdn('Set-Cookie', `${MDN_HEADER}/Set-Cookie`), mdn('Using HTTP cookies', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies')],
    cookie_httponly: [mdn('Set-Cookie', `${MDN_HEADER}/Set-Cookie`), mdn('Using HTTP cookies', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies')],
    cookie_samesite: [mdn('Set-Cookie', `${MDN_HEADER}/Set-Cookie`), mdn('Using HTTP cookies', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies')],
    mixed_content: [mdn('Mixed content', 'https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content')],
    http_status: [mdn('HTTP response status codes', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status')],
    seo_title: [google('Influencing your title links', 'https://developers.google.com/search/docs/appearance/title-link')],
    meta_description: [google('Control your snippets', 'https://developers.google.com/search/docs/appearance/snippet')],
    h1: [mdn('Heading elements', `${MDN_HTML}/Elements/Heading_Elements`)],
    heading_order: [mdn('Heading elements', `${MDN_HTML}/Elements/Heading_Elements`)],
    viewport: [mdn('Viewport meta tag', `${MDN_HTML}/Elements/meta/name/viewport`)],
    html_lang: [mdn('The lang attribute', `${MDN_HTML}/Global_attributes/lang`)],
    canonical: [google('Consolidate duplicate URLs', `${GOOGLE_CRAWL}/consolidate-duplicate-urls`)],
    noindex: [google('Block search indexing', `${GOOGLE_CRAWL}/block-indexing`)],
    open_graph: [{ source: 'The Open Graph protocol', title: 'Specification', url: 'https://ogp.me/' }],
    open_graph_quality: [{ source: 'The Open Graph protocol', title: 'Specification', url: 'https://ogp.me/' }],
    img_alt: [mdn('The img element', `${MDN_HTML}/Elements/img`)],
    img_dimensions: [mdn('The img element', `${MDN_HTML}/Elements/img`)],
    favicon: [google('Define a favicon', 'https://developers.google.com/search/docs/appearance/favicon-in-search')],
    json_ld: [google('Intro to structured data', 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data')],
    hreflang: [google('Localized versions of your pages', 'https://developers.google.com/search/docs/specialty/international/localized-versions')],
    robots_txt: [google('Introduction to robots.txt', `${GOOGLE_CRAWL}/robots/intro`)],
    robots_allows_page: [google('How Google interprets the robots.txt specification', `${GOOGLE_CRAWL}/robots/robots_txt`)],
    sitemap_xml: [google('Sitemaps overview', `${GOOGLE_CRAWL}/sitemaps/overview`)],
    sitemap_in_robots: [google('Build and submit a sitemap', `${GOOGLE_CRAWL}/sitemaps/build-sitemap`)],
    sitemap_urls: [google('Sitemaps overview', `${GOOGLE_CRAWL}/sitemaps/overview`)],
    redirect_chain: [google('Redirects and Google Search', `${GOOGLE_CRAWL}/301-redirects`)],
    soft_404: [google('HTTP status codes and errors', 'https://developers.google.com/crawling/docs/troubleshooting/http-status-codes')],
    llms_txt: [{ source: 'llmstxt.org', title: 'The /llms.txt proposal', url: 'https://llmstxt.org/' }],
    link_headers: [{ source: 'IETF', title: 'RFC 8288: Web Linking', url: 'https://www.rfc-editor.org/rfc/rfc8288' }],
    api_catalog: [{ source: 'IETF', title: 'RFC 9727: api-catalog', url: 'https://www.rfc-editor.org/rfc/rfc9727' }],
    oauth_resource: [{ source: 'IETF', title: 'RFC 9728: OAuth 2.0 Protected Resource Metadata', url: 'https://www.rfc-editor.org/rfc/rfc9728' }],
    a2a_agent_card: [{ source: 'A2A Protocol', title: 'Agent2Agent protocol specification', url: 'https://a2a-protocol.org/latest/specification/' }],
    markdown_negotiation: [
        mdn('Content negotiation', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Content_negotiation'),
        mdn('Vary', `${MDN_HEADER}/Vary`),
        { source: 'llmstxt.org', title: 'Markdown versions of pages', url: 'https://llmstxt.org/' },
    ],
    ai_crawlers: [{ source: 'OpenAI', title: 'Overview of OpenAI crawlers', url: 'https://platform.openai.com/docs/bots' }, google('Introduction to robots.txt', `${GOOGLE_CRAWL}/robots/intro`)],
    content_in_html: [google('JavaScript SEO basics', `${GOOGLE_CRAWL}/javascript/javascript-seo-basics`)],
    canonical_host: [google('Consolidate duplicate URLs', `${GOOGLE_CRAWL}/consolidate-duplicate-urls`)],
};
