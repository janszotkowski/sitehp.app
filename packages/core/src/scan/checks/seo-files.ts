import type { CheckDefinition, CheckOutcome, Group } from '../check.ts';
import { blocked, wallOf } from '../gate.ts';
import { isCompressedFile, isFile, parseRobots, parseSitemap, robotsVerdict, sameSite } from '../site-files.ts';
import { hideQueryValues } from '../url.ts';

const seo = (id: string, group: Group, severity: CheckDefinition['severity'], run: CheckDefinition['run']): CheckDefinition => ({
    id,
    category: 'seo',
    group,
    layer: 'light',
    severity,
    effort: 'minutes',
    run,
});

const unreachable: CheckOutcome = { status: 'skipped', evidence: {}, skippedReason: 'unreachable' };

const ok = (status: number): boolean => status >= 200 && status < 300;

const turnedAway: CheckOutcome = { status: 'skipped', evidence: {}, skippedReason: 'blocked' };

/** SEO: `robots.txt` exists and answers. A missing one only warns (search engines then crawl everything); a server error fails, because Google then stays away. Whether it blocks the page is `robots_allows_page`. */
const robotsTxt = seo('robots_txt', 'files', 'medium', ({ robots }) => {
    if (robots === undefined) throw new Error('this check needs robots.txt');
    if (robots === null) return unreachable;
    // A server error makes Google treat the whole site as off limits until it recovers.
    if (robots.status >= 500) return { status: 'fail', evidence: { present: false, status: robots.status } };
    if (blocked(robots.status)) return turnedAway;
    if (!isFile(robots)) return { status: 'warn', evidence: { present: false, status: robots.status } };
    const info = parseRobots(robots.body);
    return { status: 'pass', evidence: { present: true, blocksAll: info.blocksAll, sitemaps: info.sitemaps.length } };
});

const pathAndQuery = (address: string): string | undefined => {
    try {
        const url = new URL(address);
        return url.pathname + url.search;
    } catch {
        return undefined;
    }
};

// Parameters that ad and mail tools add to a shared link: the page crawlers know has none of them.
const TRACKING = /^(?:utm_[a-z]+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|mc_cid|mc_eid|yclid|igshid|_ga|_gl)$/i;

/** The path and query with the tracking parameters dropped, so a pasted `/?utm_source=fb` is judged as the `/` a crawler requests. */
const withoutTracking = (path: string): string => {
    const start = path.indexOf('?');
    if (start === -1) return path;
    const kept = path
        .slice(start + 1)
        .split('&')
        .filter((pair) => pair !== '' && !TRACKING.test(pair.split('=')[0] ?? ''));
    return kept.length === 0 ? path.slice(0, start) : `${path.slice(0, start)}?${kept.join('&')}`;
};

/**
 * SEO: `robots.txt` lets Googlebot fetch the scanned page (the longest matching rule decides, as Google does). A forgotten `Disallow: /`
 * keeps every search engine out, and a blocked page also hides its own `noindex` from them. Critical: it holds the HP down like `noindex`.
 */
const robotsAllowsPage = seo('robots_allows_page', 'indexing', 'critical', ({ robots, page, url }) => {
    if (robots === undefined) throw new Error('this check needs robots.txt');
    if (robots === null) return unreachable;
    if (blocked(robots.status)) return turnedAway;
    // A server error is `robots_txt`'s finding; no file, or an HTML fallback, forbids nothing.
    if (robots.status >= 500) return { status: 'skipped', evidence: { status: robots.status }, skippedReason: 'robots_error' };
    if (!isFile(robots)) return { status: 'skipped', evidence: { present: false }, skippedReason: 'no_robots' };
    // The page as crawled: where the scan ended up, when that is still this site.
    const final = page === undefined ? undefined : pathAndQuery(page.finalUrl);
    const path = withoutTracking(final !== undefined && page !== undefined && sameSite(new URL(page.finalUrl).host, url.host) ? final : url.path);
    const verdict = robotsVerdict(robots.body, path);
    // The report is public: the query's keys are shown, never its values (a token, a session).
    return { status: verdict.allowed ? 'pass' : 'fail', evidence: { path: hideQueryValues(path).slice(0, 200), allowed: verdict.allowed, rule: verdict.rule?.slice(0, 200) ?? null } };
});

// The site's own hosts: the one scanned, and the one its page redirected to (a site that moved lists its new address).
const sitemapHost = (loc: string, hosts: readonly string[]): 'own' | 'insecure' | 'foreign' => {
    try {
        const url = new URL(loc);
        if (!hosts.some((host) => sameSite(url.host, host))) return 'foreign';
        return url.protocol === 'https:' ? 'own' : 'insecure';
    } catch {
        // A relative or broken address: search engines skip it.
        return 'foreign';
    }
};

/**
 * SEO: a sitemap exists and is valid XML with addresses in it, each absolute, on this site and on https (when the site is). It tells search engines
 * which pages there are; an address elsewhere is dropped. `<lastmod>` is counted, not judged: it is optional, and `priority` and `changefreq` are ignored by Google.
 */
const sitemapXml = seo('sitemap_xml', 'files', 'medium', ({ sitemap, url, page }) => {
    if (sitemap === undefined) throw new Error('this check needs the sitemap');
    if (sitemap === null) return unreachable;
    if (isCompressedFile(sitemap.url)) return { status: 'skipped', evidence: { url: sitemap.url }, skippedReason: 'compressed' };
    if (blocked(sitemap.status)) return turnedAway;
    if (!isFile(sitemap)) return { status: 'warn', evidence: { present: false, status: sitemap.status } };
    const info = parseSitemap(sitemap.body, !sitemap.truncated);
    if (info.kind === 'invalid') return { status: 'fail', evidence: { present: true, valid: false } };
    const own = page === undefined ? [url.host] : [url.host, hostOf(page.finalUrl)];
    const hosts = info.locations.map((loc) => sitemapHost(loc, own));
    const foreign = hosts.filter((kind) => kind === 'foreign').length;
    // http addresses on an https site send crawlers through a redirect for every page.
    const insecure = url.scheme === 'https' ? hosts.filter((kind) => kind === 'insecure').length : 0;
    const lastmod = (sitemap.body.match(/<(?:[\w-]+:)?lastmod[\s>]/gi) ?? []).length;
    const status = info.locations.length === 0 || foreign > 0 || insecure > 0 ? 'warn' : 'pass';
    return { status, evidence: { present: true, valid: true, kind: info.kind, addresses: info.locations.length, foreign, insecure, lastmod, truncated: sitemap.truncated } };
});

/** SEO: `robots.txt` names the sitemap, the one place every crawler looks for it. */
const sitemapInRobots = seo('sitemap_in_robots', 'files', 'low', ({ robots }) => {
    if (robots === undefined) throw new Error('this check needs robots.txt');
    if (robots === null || !isFile(robots)) return { status: 'skipped', evidence: {}, skippedReason: 'no_robots' };
    const listed = parseRobots(robots.body).sitemaps.length;
    return { status: listed > 0 ? 'pass' : 'warn', evidence: { listed } };
});

/**
 * SEO: the addresses a sitemap lists answer, and are pages meant for search: not `noindex`, and their own canonical. A sitemap full of dead,
 * redirecting or duplicate pages teaches search engines to distrust it. Looks at a small sample only.
 */
const sitemapUrls = seo('sitemap_urls', 'files', 'medium', ({ sitemapSample, page, url }) => {
    if (sitemapSample === undefined) throw new Error('this check needs the sitemap sample');
    if (sitemapSample.length === 0) return { status: 'skipped', evidence: {}, skippedReason: 'no_sample' };
    // An address the firewall turned away is not dead; it is left out of the count.
    const judged = sitemapSample.filter((entry) => !blocked(entry.status));
    if (judged.length === 0) return turnedAway;
    const failing = judged.filter((entry) => !ok(entry.status));
    // Behind a consent or login wall every sampled page redirects to the same wall: only dead pages say something then.
    const walled = page !== undefined && wallOf(page, url) !== null;
    const redirected = walled ? [] : judged.filter((entry) => ok(entry.status) && entry.redirected === true);
    const unindexable = walled
        ? []
        : judged.filter((entry) => ok(entry.status) && entry.redirected !== true && (entry.noindex === true || (typeof entry.canonical === 'string' && !sameListing(entry.canonical, entry.url))));
    const status = failing.length * 2 > judged.length ? 'fail' : failing.length > 0 || redirected.length > 0 || unindexable.length > 0 ? 'warn' : 'pass';
    const example = failing[0]?.url ?? redirected[0]?.url ?? unindexable[0]?.url ?? '';
    return {
        status,
        evidence: {
            sampled: judged.length,
            failing: failing.length,
            redirected: redirected.length,
            unindexable: unindexable.length,
            blocked: sitemapSample.length - judged.length,
            example: example.slice(0, 200),
        },
    };
});

// The listed address and the canonical name the same page: a trailing slash aside, the query counts (a sitemap should list the canonical form).
const sameListing = (canonical: string, listed: string): boolean => {
    const key = (address: string): string => {
        const url = new URL(address);
        return url.origin + url.pathname.replace(/\/$/, '') + url.search;
    };
    try {
        return key(canonical) === key(listed);
    } catch {
        return true;
    }
};

const TEMPORARY = new Set([302, 303, 307]);

/**
 * SEO: the page is reached in few redirects, all permanent. Two hops (http to https, then to `www`) are normal; three warn and four fail.
 * Long chains waste crawl time, and a temporary hop tells search engines to keep the old address.
 */
const redirectChain = seo('redirect_chain', 'indexing', 'medium', ({ page }) => {
    if (page === undefined) throw new Error('this check needs the fetched page');
    const hops = page.redirects.length;
    // A temporary last hop on the same host is a language or session pick (`/` to `/cs/`), which Google asks to be temporary.
    const temporary = page.redirects.some((hop, index) => TEMPORARY.has(hop.status) && (index < hops - 1 || hostOf(hop.from) !== hostOf(hop.to)));
    const status = hops >= 4 ? 'fail' : hops === 3 || temporary ? 'warn' : 'pass';
    return { status, evidence: { hops, temporary } };
});

const pathOf = (url: string): string => {
    try {
        return new URL(url).pathname.replace(/\/+$/, '');
    } catch {
        return url;
    }
};

// The home page, or a localised one (`/en/`, `/cs`, `/pt-BR`), once the trailing slash is gone.
const HOME = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?$/i;

/** SEO: a page that does not exist answers 404, not 200. A "soft 404" lets search engines index endless empty pages. */
const soft404 = seo('soft_404', 'indexing', 'medium', ({ notFound }) => {
    if (notFound === undefined) throw new Error('this check needs the not-found probe');
    if (notFound === null) return unreachable;
    const { status, finalUrl, url } = notFound;
    if (blocked(status)) return turnedAway;
    // Sent to the home page, it is the classic soft 404. Sent to another page (a login wall), it is not a 404 either, but not the same fault.
    const redirected = pathOf(finalUrl) !== pathOf(url);
    const toHome = redirected && HOME.test(pathOf(finalUrl));
    if (ok(status)) return { status: redirected && !toHome ? 'warn' : 'fail', evidence: { status, finalUrl, redirected } };
    return { status: status >= 500 ? 'warn' : 'pass', evidence: { status, finalUrl, redirected } };
});

// The host, not the scheme: whether http reaches https is the job of `http_redirect`.
const hostOf = (url: string): string => {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
};

const served = <Probe extends { status: number }>(probe: Probe | null | undefined): probe is Probe => probe !== undefined && probe !== null && probe.status < 400;

/** SEO: every way into the site (with and without `www`, over http or https) ends on one host name. Two live addresses split the site's standing between two copies. */
const canonicalHost = seo('canonical_host', 'indexing', 'medium', ({ page, httpProbe, hostVariant }) => {
    if (page === undefined) throw new Error('this check needs the fetched page');
    const ends = [page.finalUrl, served(httpProbe) ? httpProbe.finalUrl : undefined, served(hostVariant) ? hostVariant.finalUrl : undefined].filter((url): url is string => url !== undefined);
    const addresses = Array.from(new Set(ends.map(hostOf)));
    return { status: addresses.length === 1 ? 'pass' : 'warn', evidence: { count: addresses.length, addresses: addresses.join(', ') } };
});

export const seoFileChecks: readonly CheckDefinition[] = [robotsTxt, robotsAllowsPage, sitemapXml, sitemapInRobots, sitemapUrls, redirectChain, soft404, canonicalHost];
