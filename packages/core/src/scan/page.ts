/**
 * The page a scan fetched: what the checks of the light layer read. It is a plain
 * value so a check stays a pure function; how it was fetched (and how that was kept
 * safe) is the backend's business.
 */
export type FetchedPage = {
    /** The URL the content really came from, after redirects. */
    finalUrl: string;
    /** HTTP status of the final response. */
    status: number;
    /** Every hop that led here, in order. Empty when there was no redirect. */
    redirects: ReadonlyArray<{ from: string; to: string; status: number }>;
    /** Response headers, lower-case names; repeated headers are joined with `, `. */
    headers: Readonly<Record<string, string>>;
    /** The `Set-Cookie` lines of the final response, one per cookie. Read by the cookie checks, never stored or shown: a cookie value can be a session. */
    cookies: readonly string[];
    contentType: string | null;
    /** The beginning of the body as text, empty for content that is not text. */
    body: string;
    /** Bytes read. The body is cut at the backend's size cap; `truncated` says so. */
    bytes: number;
    truncated: boolean;
    /** Bytes that crossed the wire for the body, before decompression. Equals `bytes` for an uncompressed body; counted up to the same cap on compressed input. */
    transferredBytes: number;
    /** Protocol negotiated for the connection (`h2`, `http/1.1`), or null when unknown (plain http, or a recording). `Alt-Svc` is in `headers`. */
    alpn: string | null;
    /** Time to the first byte of the final response, in milliseconds. */
    ttfbMs: number;
    /** Total time of the whole fetch, in milliseconds. */
    totalMs: number;
};

/** What the scanner saw when it opened a TLS connection to port 443 without trusting the certificate, so a bad one can be reported instead of ending the scan. */
export type CertificateInfo = {
    /** True when the chain is trusted and the name matches. */
    authorized: boolean;
    /** Node's reason when `authorized` is false (`CERT_HAS_EXPIRED`, `DEPTH_ZERO_SELF_SIGNED_CERT`, ...). */
    error: string | null;
    /** End of validity, ISO 8601. */
    validTo: string;
    /** Whole days until `validTo`; zero or negative once it has passed. */
    daysLeft: number;
    issuer: string;
};

/** The answer of `http://<host>/`, where it ends up after redirects. */
export type HttpProbe = { finalUrl: string; status: number };

/** A small file fetched next to the page (`robots.txt`, `sitemap.xml`), as the scanner saw it. */
export type SiteFile = {
    /** The address that was asked for. */
    url: string;
    /** HTTP status of the final response. */
    status: number;
    contentType: string | null;
    /** The beginning of the body as text. */
    body: string;
    truncated: boolean;
};

/** The scanned page asked for with `Accept: text/markdown`: what a site that serves Markdown to agents answers. */
export type MarkdownProbe = SiteFile & {
    /** The `Vary` response header: a cache must key on `Accept` when the same address answers in two formats. */
    vary: string | null;
    /** The `Link` response header, where a page may point to its Markdown version. */
    link?: string | null;
};

/** What answered at an address: where it ended up after redirects and with which status. */
export type AddressProbe = { url: string; finalUrl: string; status: number };

/** A stylesheet or script linked from the page, fetched to see how the server sends static files. */
export type AssetSample = {
    url: string;
    status: number;
    contentType: string | null;
    /** The `Content-Encoding` the server answered with, lower-case; null when it sent the file as it is. */
    contentEncoding: string | null;
    /** The caching headers as sent, null when absent. */
    cacheControl: string | null;
    etag: string | null;
    lastModified: string | null;
    /** Size after decompression, and on the wire. Cut at the fetcher's cap, so a large file is a lower bound. */
    bytes: number;
    transferredBytes: number;
};

/** One URL taken from the sitemap and the status it answered with (0 when nothing answered). */
export type SitemapSample = {
    url: string;
    status: number;
    /** True when the address answered only after a redirect: a sitemap should list final addresses. */
    redirected?: boolean;
    /** True when the page says `noindex`: a sitemap should list only pages meant for search. */
    noindex?: boolean;
    /** The page's canonical address, absolute, or null when it names none. One that is not the listed address makes the listing a duplicate. */
    canonical?: string | null;
};
