import {
    AGENT_FILE_PATHS,
    hostVariantOf,
    indexingOf,
    isCompressedFile,
    isFile,
    normalizeUrl,
    parseRobots,
    parseSitemap,
    assetUrlsOf,
    sameSite,
    sitemapLocation,
    sitemapSampleUrls,
    type AddressProbe,
    type AssetSample,
    type FetchedPage,
    type GatheredContext,
    type ScanUrl,
    type SiteFile,
} from '@sitehp.app/core';
import type { SiteFetchResult, SiteFetcher } from '@modules/scans/ports.ts';

/** What the file checks read around the page: robots.txt, the sitemap, a few of its pages, a made-up page, the other host name… */
export type SiteProbes = Omit<GatheredContext, 'url' | 'page' | 'certificate' | 'httpProbe'>;

/** How many sitemap pages are fetched: enough to see that the list is alive, few enough not to load someone else's server. */
const SAMPLE_SIZE = 3;

/** How many stylesheets and scripts of the page are fetched to see how the server sends static files. */
const ASSET_SAMPLE_SIZE = 3;

/** The format an agent asks for: Markdown first, HTML as the fallback it would accept. */
const MARKDOWN_ACCEPT = 'text/markdown, text/html;q=0.5';

const asFile = (url: string, page: FetchedPage): SiteFile => ({ url, status: page.status, contentType: page.contentType, body: page.body, truncated: page.truncated });
const asProbe = (url: string, page: FetchedPage): AddressProbe => ({ url, finalUrl: page.finalUrl, status: page.status });

/** Where the page ended up and what stops the probes: both optional, a probe without them uses the address as typed and runs to its own timeout. */
export type ProbeOptions = { finalUrl?: string; signal?: AbortSignal; page?: FetchedPage };

/**
 * The site the files are looked up on: where the page ended up (`http` → `https`, the `www` name added or removed), as a visitor and a
 * search engine see it, when that is still the scanned site; else the address as typed. A page sent to another site never moves the probes there.
 */
const siteOf = (url: ScanUrl, finalUrl: string | undefined): { scheme: 'http' | 'https'; host: string } => {
    if (finalUrl === undefined) return url;
    const final = new URL(finalUrl);
    const scheme = final.protocol === 'https:' ? 'https' : final.protocol === 'http:' ? 'http' : undefined;
    return scheme !== undefined && sameSite(final.host, url.host) ? { scheme, host: final.host } : url;
};

/**
 * Fetches the small files and probes around the page through the same safe fetcher. A probe that fails is `null`, never an error:
 * the scan goes on and the check that needed it reports itself `skipped`. The sitemap is looked up on the scanned site only (the host with or without `www`).
 * A probe that redirects off the scanned site (another registrable domain) gets no answer, like an unreachable one: a scan sends its
 * side requests to the site itself only. The Markdown version of the page is the page, and follows its redirects like the page does.
 */
export const probeSite = async (fetcher: SiteFetcher, url: ScanUrl, { finalUrl, signal, page }: ProbeOptions = {}): Promise<SiteProbes> => {
    const fetchPage = (target: string, accept?: string, stayOnSite = true): Promise<FetchedPage | null> =>
        fetcher
            .fetchPage(target, { ...(accept === undefined ? {} : { accept }), stayOnSite, ...(signal === undefined ? {} : { signal }) })
            .then((result) => (result.ok ? result.page : null))
            .catch(() => null);
    const site = siteOf(url, finalUrl);
    const origin = `${site.scheme}://${site.host}`;
    // The other name of the site the page is on: for `example.com` that ends on `www.example.com`, whether `example.com` leads there too.
    const variantHost = hostVariantOf(site.host);
    // A path nobody has: a random one, so a cache or a catch-all rule cannot have seen it before.
    const missing = `${origin}/sitehp-check-${crypto.randomUUID()}`;

    const agentPaths = Object.values(AGENT_FILE_PATHS);
    const [robotsPage, llmsPage, markdownPage, notFoundPage, variantPage, agentPages] = await Promise.all([
        fetchPage(`${origin}/robots.txt`),
        fetchPage(`${origin}/llms.txt`),
        fetchPage(url.href, MARKDOWN_ACCEPT, false),
        fetchPage(missing),
        variantHost === null ? Promise.resolve(undefined) : fetchPage(`https://${variantHost}/`),
        Promise.all(agentPaths.map((path) => fetchPage(`${origin}${path}`))),
    ]);
    const agentFiles = Object.fromEntries(
        agentPaths.map((path, index) => [path, agentPages[index] === null || agentPages[index] === undefined ? null : asFile(`${origin}${path}`, agentPages[index])]),
    );
    const llms = llmsPage === null ? null : asFile(`${origin}/llms.txt`, llmsPage);
    const markdown = markdownPage === null ? null : { ...asFile(url.href, markdownPage), vary: markdownPage.headers['vary'] ?? null, link: markdownPage.headers['link'] ?? null };
    const robots = robotsPage === null ? null : asFile(`${origin}/robots.txt`, robotsPage);
    const robotsText = robots !== null && isFile(robots) ? parseRobots(robots.body) : null;

    const sitemapUrl = sitemapLocation(robotsText, site.scheme, site.host);
    const sitemapPage = await fetchPage(sitemapUrl);
    const sitemap = sitemapPage === null ? null : asFile(sitemapUrl, sitemapPage);

    // A compressed file cannot be read as text, so it is not sampled. An index lists other sitemaps, not pages: the first of its sitemaps on this site stands in for it.
    let info = sitemap !== null && sitemap.status >= 200 && sitemap.status < 300 && !isCompressedFile(sitemap.url) ? parseSitemap(sitemap.body, !sitemap.truncated) : null;
    if (info?.kind === 'index') {
        const child = sitemapSampleUrls(info.locations, site.host, 1)[0];
        const childPage = child === undefined || isCompressedFile(child) ? null : await fetchPage(child);
        info = childPage !== null && childPage.status >= 200 && childPage.status < 300 ? parseSitemap(childPage.body, !childPage.truncated) : null;
    }
    const sampleUrls = info?.kind === 'urlset' ? sitemapSampleUrls(info.locations, site.host, SAMPLE_SIZE) : [];
    const sitemapSample = await Promise.all(
        sampleUrls.map(async (target) => {
            const page = await fetchPage(target);
            if (page === null) return { url: target, status: 0, redirected: false };
            // Only the verdict is kept, never the page: whether it is noindex, and which address it names as its own.
            return { url: target, status: page.status, redirected: page.redirects.length > 0, ...(await indexingOf(page)) };
        }),
    );

    // Only the facts of the transfer are kept, never the file.
    const assetSample = await Promise.all(
        (page === undefined ? [] : await assetUrlsOf(page, ASSET_SAMPLE_SIZE)).map(async (target): Promise<AssetSample> => {
            const asset = await fetchPage(target);
            if (asset === null) return { url: target, status: 0, contentType: null, contentEncoding: null, cacheControl: null, etag: null, lastModified: null, bytes: 0, transferredBytes: 0 };
            const encoding = asset.headers['content-encoding']?.trim().toLowerCase();
            return {
                url: target,
                status: asset.status,
                contentType: asset.contentType,
                contentEncoding: encoding === undefined || encoding === '' ? null : encoding,
                cacheControl: asset.headers['cache-control'] ?? null,
                etag: asset.headers['etag'] ?? null,
                lastModified: asset.headers['last-modified'] ?? null,
                bytes: asset.bytes,
                transferredBytes: asset.transferredBytes,
            };
        }),
    );

    return {
        robots,
        sitemap,
        sitemapSample,
        assetSample,
        llms,
        agentFiles,
        markdown,
        notFound: notFoundPage === null ? null : asProbe(missing, notFoundPage),
        ...(variantPage === undefined ? {} : { hostVariant: variantPage === null ? null : asProbe(`https://${variantHost}/`, variantPage) }),
    };
};

/**
 * The certificate a visitor is shown: of the host the page ended on when it is served over https (on the usual port), else of the
 * host as typed. The page was fetched there through the safe fetcher, and the certificate is read through the same guarded lookup.
 */
const certificateHostOf = (fetched: SiteFetchResult, typedHost: string): string => {
    if (!fetched.ok) return typedHost;
    const final = new URL(fetched.page.finalUrl);
    return final.protocol === 'https:' && final.port === '' ? final.hostname : typedHost;
};

/** Everything a scan learns from the site before the checks run. `fetched` and `httpEntry` are kept whole for the log and the failure reason. */
export type GatheredSite = {
    /** The address actually scanned: the one typed, or its http form when https did not answer and the fallback was allowed. */
    url: ScanUrl;
    fetched: SiteFetchResult;
    httpEntry: SiteFetchResult;
    context: GatheredContext;
};

/**
 * The whole contact with the scanned site: the page and the plain-http entry point in parallel; once the page is in, the certificate and
 * the small files around it, on the site the page ended on. All go through the given fetcher. An address typed without a scheme
 * (`httpFallback`) was tried as https; a site that does not answer https at all (no connection, a failed handshake) gets one try over
 * http, and is scanned there when that answers.
 */
export const gatherSite = async (fetcher: SiteFetcher, typed: ScanUrl, { httpFallback, signal }: { httpFallback: boolean; signal: AbortSignal }): Promise<GatheredSite> => {
    const pageFetch = fetcher.fetchPage(typed.href, { signal }).then(async (result) => {
        if (result.ok || !httpFallback || typed.scheme !== 'https' || (result.reason !== 'unreachable' && result.reason !== 'tls_error')) return { result, url: typed };
        const plain = normalizeUrl(typed.href.replace(/^https:/, 'http:'));
        const retried = plain.ok ? await fetcher.fetchPage(plain.url.href, { signal }) : result;
        return retried.ok && plain.ok ? { result: retried, url: plain.url } : { result, url: typed };
    });
    const [{ result: fetched, url }, httpEntry, certificate, probes] = await Promise.all([
        pageFetch,
        fetcher.fetchPage(`http://${typed.host}/`, { signal }),
        pageFetch.then(({ result }) => fetcher.inspectCertificate(certificateHostOf(result, typed.host))),
        pageFetch.then(({ result, url: site }) => probeSite(fetcher, site, { ...(result.ok ? { finalUrl: result.page.finalUrl, page: result.page } : {}), signal })),
    ]);
    const context: GatheredContext = {
        url,
        ...(fetched.ok ? { page: fetched.page } : {}),
        certificate,
        httpProbe: httpEntry.ok ? { finalUrl: httpEntry.page.finalUrl, status: httpEntry.page.status } : null,
        ...probes,
    };
    return { url, fetched, httpEntry, context };
};
