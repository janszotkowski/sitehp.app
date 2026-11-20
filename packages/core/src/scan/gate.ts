import type { CheckOutcome } from './check.ts';
import type { FetchedPage } from './page.ts';
import { sameSite } from './site-files.ts';
import { hideQueryValues } from './url.ts';
import type { ScanUrl } from './url.ts';

/** A firewall or rate limit turning the scanner away: the answer is the firewall's, not the site's. */
export const blocked = (status: number): boolean => status === 401 || status === 403 || status === 429;

/**
 * A bot challenge that answers with a status that is no refusal: Cloudflare's (`cf-mitigated`, or a 503 "Just a moment"), AWS WAF's
 * (a 202 with `x-amzn-waf-action`), Imperva's (a 200 page that only loads `_Incapsula_Resource`). Its content is the firewall's, not the site's.
 */
const challenged = (page: FetchedPage): boolean =>
    /challenge/i.test(page.headers['cf-mitigated'] ?? '') ||
    page.headers['x-amzn-waf-action'] !== undefined ||
    (page.status === 503 && page.headers['cf-ray'] !== undefined && /just a moment|challenge-platform|cf-browser-verification/i.test(page.body)) ||
    /_Incapsula_Resource|Incapsula incident ID/i.test(page.body.slice(0, 20_000));

/** A check of the fetched response skips a blocked or challenged page instead of judging the firewall's reply. Null when the page was served. */
export const blockedPage = (page: FetchedPage): CheckOutcome | null =>
    blocked(page.status) || challenged(page) ? { status: 'skipped', evidence: { status: page.status }, skippedReason: 'blocked' } : null;

const CONSENT = /consent|souhlas|cookie|gdpr|privacy[-_]?(?:gate|center)|cmp/i;
// A sign-in page: `/login`, `/signin`, `sso.`, `/auth/`, `/oauth2/authorize`, `/cas/`.
const LOGIN = /log-?in|sign-?in|(?:^|[./_-])(?:sso|auth|oauth2?|authorize|cas|idp)(?=$|[./_-])/i;

// Scheme and trailing slash differ between what was asked for and what a wall writes into its `?url=`.
const bare = (address: string): string => address.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

type Wall = 'consent_wall' | 'login_wall';

/**
 * A wall in front of the page: the site redirected the scanner to a page that asks for cookie consent (one of its own whose address names it,
 * or any that carries the requested address to return to), or to a sign-in page that carries it back (`/login?next=`, an SSO's `?service=`).
 * Its content is the wall, not the page asked for. Asking for a cookie or login page is no wall.
 */
export const wallOf = (page: FetchedPage, url: ScanUrl): Wall | null => {
    if (page.redirects.length === 0 || CONSENT.test(url.path)) return null;
    let final: URL;
    try {
        final = new URL(page.finalUrl);
    } catch {
        return null;
    }
    // Carrying the asked address back is a wall wherever it lives (`consent.yahoo.com`); a consent-named page must be the site's own or a subdomain (`cmp.`).
    if ([...final.searchParams.values()].some((value) => bare(value) === bare(url.href))) {
        const place = final.hostname + final.pathname;
        if (LOGIN.test(place) && !CONSENT.test(place)) return LOGIN.test(url.path) ? null : 'login_wall';
        return 'consent_wall';
    }
    const own = sameSite(final.hostname, url.host) || final.hostname.endsWith(`.${url.host.replace(/^www\./, '')}`);
    return own && CONSENT.test(final.pathname + final.search) ? 'consent_wall' : null;
};

/** A check of the page's content skips a consent or login wall instead of judging the wall. Null when the page is the one asked for. */
export const wallPage = (page: FetchedPage, url: ScanUrl): CheckOutcome | null => {
    const wall = wallOf(page, url);
    return wall === null ? null : { status: 'skipped', evidence: { finalUrl: hideQueryValues(page.finalUrl).slice(0, 200) }, skippedReason: wall };
};
