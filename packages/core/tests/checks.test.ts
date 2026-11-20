import { describe, expect, it } from 'vitest';
import {
    CHECKS,
    CHECK_IDS,
    checkResultSchema,
    computeScore,
    fixGain,
    indexingOf,
    scoreBreakdown,
    CATEGORY_WEIGHT,
    CRITICAL_CAP,
    normalizeUrl,
    runCheck,
    type CheckContext,
    type CheckDefinition,
    type CertificateInfo,
    assetUrlsOf,
    type FetchedPage,
    type HttpProbe,
    type MarkdownProbe,
    type SiteFile,
} from '@src/index.ts';
import { simulateFix } from '@src/scan/score.ts';
import { hideQueryValues } from '@src/scan/url.ts';
import { AI_RETRIEVAL_AGENTS } from '@src/scan/site-files.ts';

const page = (overrides: Partial<FetchedPage> = {}): FetchedPage => ({
    finalUrl: 'https://example.com/',
    status: 200,
    redirects: [],
    headers: {},
    cookies: [],
    contentType: 'text/html',
    body: '',
    bytes: 0,
    transferredBytes: 0,
    alpn: null,
    truncated: false,
    ttfbMs: 10,
    totalMs: 20,
    ...overrides,
});

const GOOD_HTML =
    '<!doctype html><html lang="en"><head><title>A good page title that is long enough</title>' +
    `<meta name="description" content="${'d'.repeat(100)}"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    '<link rel="canonical" href="https://example.com/"><link rel="icon" href="/favicon.ico">' +
    '<meta property="og:title" content="T"><meta property="og:description" content="D"><meta property="og:image" content="https://example.com/i.png"><meta property="og:url" content="https://example.com/">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Example"><meta property="og:locale" content="en_US"><meta property="og:image:alt" content="A picture">' +
    '<meta name="twitter:card" content="summary"><script type="application/ld+json">{"@type":"WebSite"}</script></head><body><h1>Hello</h1><h2>Sub</h2><img src="/a.png" alt="A" width="10" height="10"><p>' +
    'A readable sentence about what this page offers to a visitor. '.repeat(8) +
    '</p></body></html>';

const context = (input: string, withPage?: FetchedPage): CheckContext => {
    const result = normalizeUrl(input);
    if (!result.ok) throw new Error(result.reason);
    return withPage === undefined ? { url: result.url } : { url: result.url, page: withPage };
};

const byId = (id: string): CheckDefinition => {
    const found = CHECKS.find((check) => check.id === id);
    if (found === undefined) throw new Error(`no check ${id}`);
    return found;
};

describe('the check registry', () => {
    it('lists unique ids', () => {
        expect(new Set(CHECK_IDS).size).toBe(CHECK_IDS.length);
    });

    it('produces results that match the unified result shape', async () => {
        for (const check of CHECKS) {
            expect(checkResultSchema.safeParse(await runCheck(check, context('https://example.com', page()))).success).toBe(true);
        }
    });
});

describe('https_scheme', () => {
    it('passes on https and fails on http, with the scheme as evidence', async () => {
        const pass = await runCheck(byId('https_scheme'), context('https://example.com'));
        const fail = await runCheck(byId('https_scheme'), context('http://example.com'));
        expect(pass).toMatchObject({ status: 'pass', pointsLost: 0, evidence: { scheme: 'https' } });
        expect(fail).toMatchObject({ status: 'fail', pointsLost: 8, evidence: { scheme: 'http' }, category: 'security', severity: 'critical' });
    });

    it('judges where the page is really served from after redirects, not what was typed', async () => {
        const upgraded = page({ finalUrl: 'https://example.com/', redirects: [{ from: 'http://example.com/', to: 'https://example.com/', status: 301 }] });
        const downgraded = page({ finalUrl: 'http://example.com/', redirects: [{ from: 'https://example.com/', to: 'http://example.com/', status: 302 }] });
        expect(await runCheck(byId('https_scheme'), context('http://example.com', upgraded))).toMatchObject({ status: 'pass', evidence: { scheme: 'http', finalScheme: 'https' } });
        expect(await runCheck(byId('https_scheme'), context('https://example.com', downgraded))).toMatchObject({ status: 'fail', evidence: { scheme: 'https', finalScheme: 'http' } });
    });
});

describe('http_status', () => {
    it('passes a 2xx and fails a 4xx or 5xx, with the status and the redirect count as evidence', async () => {
        const redirected = page({ redirects: [{ from: 'http://example.com/', to: 'https://example.com/', status: 301 }] });
        expect(await runCheck(byId('http_status'), context('https://example.com', redirected))).toMatchObject({ status: 'pass', evidence: { status: 200, redirects: 1 } });
        for (const status of [404, 500]) {
            expect(await runCheck(byId('http_status'), context('https://example.com', page({ status })))).toMatchObject({
                status: 'fail',
                pointsLost: 8,
                category: 'seo',
                severity: 'critical',
                evidence: { status },
            });
        }
    });

    it('reports itself skipped when no page was fetched, instead of guessing', async () => {
        expect(await runCheck(byId('http_status'), context('https://example.com'))).toMatchObject({ status: 'skipped', skippedReason: 'check_error' });
    });
});

describe('runCheck', () => {
    it('turns a check that throws into skipped instead of failing the scan', async () => {
        const broken: CheckDefinition = {
            id: 'broken',
            category: 'security',
            group: 'https',
            layer: 'light',
            severity: 'high',
            effort: 'minutes',
            run: () => {
                throw new Error('boom');
            },
        };
        expect(await runCheck(broken, context('https://example.com'))).toMatchObject({ status: 'skipped', pointsLost: 0, skippedReason: 'check_error' });
    });

    it('awaits an asynchronous check', async () => {
        const later: CheckDefinition = { ...byId('https_scheme'), id: 'later', run: () => Promise.resolve({ status: 'pass', evidence: {} }) };
        expect((await runCheck(later, context('https://example.com'))).status).toBe('pass');
    });
});

describe('computeScore', () => {
    const goodHeaders = {
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'; base-uri 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'camera=()',
        'cross-origin-opener-policy': 'same-origin',
    };
    const results = async (input: string, withPage: FetchedPage = page({ headers: goodHeaders, body: GOOD_HTML })) => Promise.all(CHECKS.map((check) => runCheck(check, context(input, withPage))));

    it('is null when nothing ran yet', () => {
        expect(computeScore([])).toBeNull();
    });

    it('is 100 when everything passes', async () => {
        expect(computeScore(await results('https://example.com'))).toBe(100);
    });

    it('drops by the weight of what failed, within the category it failed in', async () => {
        // No frame protection (x_frame_options fails, 3 of the security weight) and a canonical that names another page (a seo warn).
        const { 'x-frame-options': _frame, ...framable } = goodHeaders;
        const flawed = page({ headers: framable, body: GOOD_HTML.replace('href="https://example.com/"', 'href="https://example.com/other"') });
        const breakdown = scoreBreakdown(await results('https://example.com', flawed));
        expect(breakdown).toMatchObject({ score: 95, capped: false, cappedBy: [] });
        const byCategory = Object.fromEntries((breakdown?.categories ?? []).map((item) => [item.category, item.score]));
        expect(byCategory.security).toBeLessThan(100);
        expect(byCategory.seo).toBeLessThan(100);
    });

    it('holds an error page or a site only on http at the cap, and names what holds it', async () => {
        // A 500: the checks that read the HTML no longer run, so without the cap the headers alone would score it high.
        expect(scoreBreakdown(await results('https://example.com', page({ status: 500, headers: goodHeaders, body: GOOD_HTML })))).toMatchObject({
            score: CRITICAL_CAP,
            capped: true,
            cappedBy: ['http_status'],
        });
        const http = page({ finalUrl: 'http://example.com/', headers: goodHeaders, body: GOOD_HTML });
        expect(scoreBreakdown(await results('http://example.com', http))).toMatchObject({ score: CRITICAL_CAP, cappedBy: ['https_scheme'] });
    });

    it('says how many checks of a category ran out of how many there were', async () => {
        const all = await results('https://example.com');
        const security = scoreBreakdown(all)?.categories.find((item) => item.category === 'security');
        expect(security?.total).toBe(all.filter((result) => result.category === 'security').length);
        expect(security?.checks).toBeLessThan(security?.total ?? 0);
    });

    it('shares the weight of a category that did not run among the others', async () => {
        const all = await results('https://example.com');
        const securityOnly = all.filter((result) => result.category === 'security');
        expect(scoreBreakdown(securityOnly)?.categories).toEqual([expect.objectContaining({ category: 'security', share: 1 })]);
        const both = scoreBreakdown(all)?.categories.map((item) => item.share);
        expect(both?.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
        expect(CATEGORY_WEIGHT.security).toBeGreaterThan(CATEGORY_WEIGHT.seo);
    });

    it('holds the score at the cap after a failed critical check, however well the rest does', async () => {
        const untrusted: CertificateInfo = { authorized: false, error: 'CERT_HAS_EXPIRED', validTo: '2020-01-01T00:00:00.000Z', daysLeft: -100, issuer: 'CA' };
        const bad = await Promise.all(CHECKS.map((check) => runCheck(check, { ...context('https://example.com', page({ headers: goodHeaders, body: GOOD_HTML })), certificate: untrusted })));
        expect(bad.find((result) => result.checkId === 'cert_valid')).toMatchObject({ status: 'fail', severity: 'critical' });
        expect(scoreBreakdown(bad)).toMatchObject({ score: CRITICAL_CAP, capped: true, cappedBy: ['cert_valid'] });
        // Fixing something else gains nothing while the cap holds; fixing the critical check lifts it.
        expect(fixGain(bad, 'hsts')).toBe(0);
        expect(fixGain(bad, 'cert_valid')).toBeGreaterThan(0);
        expect(simulateFix(bad, ['cert_valid'])).toBeGreaterThan(CRITICAL_CAP);
    });

    it('simulates a fix without touching the results, and leaves a skipped check skipped', async () => {
        const http = await results('https://example.com', page({ headers: {}, body: GOOD_HTML }));
        const before = computeScore(http);
        expect(simulateFix(http, ['hsts'])).toBeGreaterThan(before ?? 100);
        expect(computeScore(http)).toBe(before);
        expect(simulateFix(http, [])).toBe(before);
    });

    it('is null when the page turned the scanner away, whatever else ran', async () => {
        // A bot wall: https and the certificate still pass, but every check of the page's own response is skipped.
        const blocked = await results('https://example.com', page({ status: 403, headers: { server: 'cloudflare' }, body: '<html>Just a moment</html>' }));
        expect(blocked.find((result) => result.checkId === 'http_status')).toMatchObject({ status: 'skipped', skippedReason: 'blocked', evidence: { status: 403 } });
        expect(blocked.find((result) => result.checkId === 'https_scheme')?.status).toBe('pass');
        expect(computeScore(blocked)).toBeNull();
        expect(blocked.every((result) => fixGain(blocked, result.checkId) === 0)).toBe(true);
    });

    it('leaves skipped checks out', async () => {
        const [first] = await results('https://example.com');
        if (first === undefined) throw new Error('no result');
        expect(computeScore([{ ...first, status: 'skipped', pointsLost: 0 }])).toBeNull();
    });
});

describe('security headers', () => {
    const run = (id: string, headers: Record<string, string>) => runCheck(byId(id), context('https://example.com', page({ headers })));

    it('fails a missing header and passes a present one', async () => {
        expect(await run('csp', {})).toMatchObject({ status: 'fail', pointsLost: 3, evidence: { present: false } });
        expect(await run('csp', { 'content-security-policy': "default-src 'self'; base-uri 'none'" })).toMatchObject({ status: 'pass' });
        expect(await run('referrer_policy', { 'referrer-policy': 'no-referrer' })).toMatchObject({ status: 'pass' });
    });

    it('only warns when a header with a safe browser default is missing', async () => {
        for (const id of ['referrer_policy', 'permissions_policy', 'coop']) expect(await run(id, {}), id).toMatchObject({ status: 'warn', pointsLost: 0.5 });
        expect(await run('coop', { 'cross-origin-opener-policy': 'same-origin' })).toMatchObject({ status: 'pass' });
    });

    it('warns on a short HSTS lifetime, passes a long one, and does not judge it on an http page', async () => {
        expect(await run('hsts', { 'strict-transport-security': 'max-age=300' })).toMatchObject({ status: 'warn' });
        expect(await run('hsts', { 'strict-transport-security': 'max-age="31536000"' })).toMatchObject({ status: 'pass' });
        expect(await run('hsts', { 'strict-transport-security': 'max-age=31536000; includeSubDomains' })).toMatchObject({
            status: 'pass',
            evidence: { includeSubDomains: true, preload: false },
        });
        const http = page({ finalUrl: 'http://example.com/', headers: {} });
        expect(await runCheck(byId('hsts'), context('http://example.com', http))).toMatchObject({ status: 'skipped', skippedReason: 'not_applicable' });
    });

    it('accepts frame-ancestors in place of X-Frame-Options, but not one that lets anyone frame the page', async () => {
        expect(await run('x_frame_options', {})).toMatchObject({ status: 'fail' });
        expect(await run('x_frame_options', { 'x-frame-options': 'DENY' })).toMatchObject({ status: 'pass' });
        expect(await run('x_frame_options', { 'x-frame-options': 'ALLOW-FROM https://a.test' })).toMatchObject({ status: 'warn' });
        // Sent twice by the server and the app: the same value repeated is still one valid value.
        expect(await run('x_frame_options', { 'x-frame-options': 'SAMEORIGIN, SAMEORIGIN' })).toMatchObject({ status: 'pass' });
        expect(await run('x_frame_options', { 'x-frame-options': 'DENY, SAMEORIGIN' })).toMatchObject({ status: 'warn' });
        expect(await run('x_frame_options', { 'content-security-policy': "frame-ancestors 'none'" })).toMatchObject({ status: 'pass' });
        expect(await run('x_frame_options', { 'content-security-policy': 'frame-ancestors *', 'x-frame-options': 'DENY' })).toMatchObject({ status: 'fail', evidence: { open: true } });
    });

    it('wants nosniff exactly', async () => {
        expect(await run('x_content_type_options', { 'x-content-type-options': 'nosniff' })).toMatchObject({ status: 'pass' });
        expect(await run('x_content_type_options', { 'x-content-type-options': 'sniff' })).toMatchObject({ status: 'warn' });
        expect(await run('x_content_type_options', { 'x-content-type-options': 'nosniff, nosniff' })).toMatchObject({ status: 'pass' });
    });

    it('warns on a CSP that allows inline scripts without a nonce or hash, a script from anywhere, or leaves plugins and <base> open', async () => {
        const csp = async (value: string) => run('csp', { 'content-security-policy': value });
        const closed = "; object-src 'none'; base-uri 'none'";
        expect(await csp(`script-src 'self' 'unsafe-inline'${closed}`)).toMatchObject({ status: 'warn', evidence: { issues: 'unsafe-inline' } });
        expect(await csp(`script-src 'self' 'unsafe-eval'${closed}`)).toMatchObject({ status: 'warn', evidence: { issues: 'unsafe-eval' } });
        expect(await csp(`default-src 'self'; style-src 'unsafe-inline'; base-uri 'none'`)).toMatchObject({ status: 'pass' });
        // A nonce, a hash or 'strict-dynamic' overrides 'unsafe-inline' in every current browser: it is only a fallback for old ones.
        for (const guard of ["'nonce-abc123'", "'sha256-AAAA'", "'strict-dynamic' 'nonce-abc'"]) expect((await csp(`script-src 'unsafe-inline' ${guard}${closed}`)).status, guard).toBe('pass');
        expect(await csp(`script-src 'self' https:${closed}`)).toMatchObject({ status: 'warn', evidence: { issues: 'wide-source' } });
        expect((await csp(`script-src 'strict-dynamic' 'nonce-abc' https:${closed}`)).status).toBe('pass');
        expect(await csp("script-src 'self'")).toMatchObject({ status: 'warn', evidence: { issues: 'no-object-src, no-base-uri' } });
        expect(await csp("frame-ancestors 'none'")).toMatchObject({ status: 'warn', evidence: { issues: 'no-script-src, no-object-src, no-base-uri' } });
    });

    it('reads several CSP headers as several policies, each enforced', async () => {
        // The safe fetch joins a repeated header with `, `.
        expect(await run('csp', { 'content-security-policy': "upgrade-insecure-requests, default-src 'self'; base-uri 'none'" })).toMatchObject({ status: 'pass', evidence: { issues: '' } });
        expect(await run('csp', { 'content-security-policy': "script-src 'unsafe-inline'; object-src 'none'; base-uri 'none', script-src 'nonce-abc'" })).toMatchObject({ status: 'pass' });
        // A policy without script rules closes no script hole another one leaves open.
        expect(await run('csp', { 'content-security-policy': "script-src 'unsafe-inline', object-src 'none'; frame-ancestors 'none'" })).toMatchObject({
            status: 'warn',
            evidence: { issues: 'unsafe-inline, no-base-uri' },
        });
        expect(await run('x_frame_options', { 'content-security-policy': "upgrade-insecure-requests, frame-ancestors 'self'" })).toMatchObject({ status: 'pass', evidence: { source: 'csp' } });
        expect(await run('x_frame_options', { 'content-security-policy': "frame-ancestors *, frame-ancestors 'self'" })).toMatchObject({ status: 'pass', evidence: { open: false } });
    });

    it('judges a CSP in a <meta> tag when the header is missing, but never takes frame-ancestors from it', async () => {
        const meta = (content: string) => page({ body: `<html><head><meta http-equiv="Content-Security-Policy" content="${content}"></head><body></body></html>` });
        expect(await runCheck(byId('csp'), context('https://example.com', meta("default-src 'self'; base-uri 'none'")))).toMatchObject({
            status: 'pass',
            evidence: { present: true, source: 'meta', value: "default-src 'self'; base-uri 'none'" },
        });
        expect(await runCheck(byId('csp'), context('https://example.com', meta("script-src 'self' 'unsafe-eval'")))).toMatchObject({ status: 'warn', evidence: { source: 'meta' } });
        expect((await runCheck(byId('x_frame_options'), context('https://example.com', meta("frame-ancestors 'none'")))).status).toBe('fail');
        // Outside <head> a browser ignores it.
        const inBody = page({ body: `<html><body><meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'none'"></body></html>` });
        expect((await runCheck(byId('csp'), context('https://example.com', inBody))).status).toBe('fail');
    });

    it('warns on a leaky Referrer-Policy, reading the last policy a browser understands', async () => {
        expect(await run('referrer_policy', { 'referrer-policy': 'unsafe-url' })).toMatchObject({ status: 'warn' });
        expect(await run('referrer_policy', { 'referrer-policy': 'no-referrer-when-downgrade, strict-origin-when-cross-origin' })).toMatchObject({
            status: 'pass',
            evidence: { policy: 'strict-origin-when-cross-origin' },
        });
        expect(await run('referrer_policy', { 'referrer-policy': 'strict-origin, made-up' })).toMatchObject({ status: 'pass', evidence: { policy: 'strict-origin' } });
    });

    it('warns when the server announces its software or version', async () => {
        expect(await run('info_leak', { server: 'nginx' })).toMatchObject({ status: 'pass' });
        expect(await run('info_leak', { server: 'nginx/1.25.3' })).toMatchObject({ status: 'warn' });
        expect(await run('info_leak', { 'x-powered-by': 'Express' })).toMatchObject({ status: 'warn' });
        for (const server of ['Apache/2.4.41 (Ubuntu)', 'Microsoft-IIS/10.0', 'nginx 1.18.0']) expect(await run('info_leak', { server }), server).toMatchObject({ status: 'warn' });
        // A pod or edge name with digits in it is no version.
        expect(await run('info_leak', { server: 'mw-web.eqiad.main-67c8cb7f6b-bnlcb' })).toMatchObject({ status: 'pass' });
        // An edge node id in parentheses (example.com's) is no version either.
        expect(await run('info_leak', { server: 'ECS (dcb/7F84)' })).toMatchObject({ status: 'pass' });
    });

    it('skips every check of the response when a firewall answered 401, 403 or 429', async () => {
        for (const status of [401, 403, 429]) {
            const blocked = page({ status, headers: { server: 'nginx/1.25.3' }, cookies: ['id=1'], body: GOOD_HTML });
            for (const id of ['hsts', 'csp', 'x_frame_options', 'info_leak', 'cookie_secure', 'mixed_content', 'http_status', 'seo_title', 'img_alt']) {
                expect(await runCheck(byId(id), context('https://example.com', blocked)), `${id} ${status}`).toMatchObject({ status: 'skipped', skippedReason: 'blocked', evidence: { status } });
            }
        }
    });

    it('takes a bot challenge for a block, whatever status it answers with, and gives no score', async () => {
        const challenges = [
            page({ status: 503, headers: { 'cf-ray': '8f1', server: 'cloudflare' }, body: '<html><title>Just a moment...</title></html>' }),
            page({ status: 403, headers: { 'cf-mitigated': 'challenge' } }),
            page({ status: 202, headers: { 'x-amzn-waf-action': 'challenge' }, body: '<html></html>' }),
            page({ status: 200, body: '<html><head><meta name="robots" content="noindex,nofollow"><script src="/_Incapsula_Resource?x=1"></script></head></html>' }),
        ];
        for (const challenge of challenges) {
            const results = await Promise.all(CHECKS.map((check) => runCheck(check, context('https://example.com', challenge))));
            expect(
                results.find((result) => result.checkId === 'http_status'),
                String(challenge.status),
            ).toMatchObject({ status: 'skipped', skippedReason: 'blocked' });
            expect(results.find((result) => result.checkId === 'noindex')?.status).toBe('skipped');
            expect(computeScore(results)).toBeNull();
        }
        // A real 503 from the site itself is still the site's answer.
        expect(await runCheck(byId('http_status'), context('https://example.com', page({ status: 503, body: 'Service unavailable' })))).toMatchObject({ status: 'fail' });
    });

    it('is skipped without the fetched page', async () => {
        expect(await runCheck(byId('hsts'), context('https://example.com'))).toMatchObject({ status: 'skipped' });
    });
});

describe('cookies', () => {
    const run = (id: string, cookies: string[]) => runCheck(byId(id), context('https://example.com', page({ cookies })));

    it('does not apply when the site sets no cookie', async () => {
        for (const id of ['cookie_secure', 'cookie_httponly', 'cookie_samesite'])
            expect(await run(id, [])).toMatchObject({ status: 'skipped', skippedReason: 'not_applicable', evidence: { cookies: 0 } });
    });

    it('counts a SameSite=None cookie without Secure, which browsers reject', async () => {
        expect(await run('cookie_secure', ['a=1; SameSite=None', 'b=1; SameSite=None; Secure', 'c=1'])).toMatchObject({ status: 'fail', evidence: { missing: 2, rejected: 1 } });
    });

    it('fails a cookie without Secure, warns without HttpOnly or SameSite, and names the cookie but never its value', async () => {
        const result = await run('cookie_secure', ['session=topsecret; Path=/; HttpOnly', 'ok=1; Secure; HttpOnly; SameSite=Lax']);
        expect(result).toMatchObject({ status: 'fail', evidence: { cookies: 2, missing: 1, names: 'session' } });
        expect(JSON.stringify(result)).not.toContain('topsecret');
        expect(await run('cookie_httponly', ['a=1; Secure'])).toMatchObject({ status: 'warn', evidence: { names: 'a' } });
        expect(await run('cookie_samesite', ['a=1; Secure; HttpOnly'])).toMatchObject({ status: 'warn' });
        expect(await run('cookie_samesite', ['a=1; samesite=Strict'])).toMatchObject({ status: 'pass' });
    });
});

describe('mixed_content', () => {
    const run = (body: string, finalUrl = 'https://example.com/') => runCheck(byId('mixed_content'), context('https://example.com', page({ body, finalUrl })));

    it('passes a page that loads everything over https, and ignores plain links', async () => {
        expect(await run('<script src="https://a.test/x.js"></script><a href="http://other.test">x</a><link rel="canonical" href="http://example.com/">')).toMatchObject({
            status: 'pass',
            evidence: { active: 0, passive: 0 },
        });
    });

    it('fails an http script or stylesheet and warns on an http image', async () => {
        expect(await run('<script src="http://a.test/x.js"></script>')).toMatchObject({ status: 'fail', evidence: { active: 1, example: 'http://a.test/x.js' } });
        expect(await run("<link rel='stylesheet' href='http://a.test/s.css'>")).toMatchObject({ status: 'fail' });
        expect(await run('<img alt="x" src=http://a.test/i.png>')).toMatchObject({ status: 'warn', evidence: { passive: 1, active: 0 } });
    });

    it('ignores resources the browser never loads: in a comment, a template or a script string', async () => {
        expect(await run('<!-- <script src="http://a.test/x.js"></script> --><template><img src="http://a.test/i.png"></template>')).toMatchObject({ status: 'pass' });
        expect(await run('<script>document.write("<img src=\'http://a.test/i.png\'>")</script>')).toMatchObject({ status: 'pass' });
        expect(await run('<link rel="preload stylesheet" href="&#104;ttp://a.test/s.css">')).toMatchObject({ status: 'fail' });
    });

    it('does not read a lazy-loading data-src as the loaded address', async () => {
        expect(await run('<img data-src="http://a.test/i.png" src="https://a.test/i.png">')).toMatchObject({ status: 'pass' });
    });

    it('passes when the CSP upgrades insecure requests', async () => {
        const upgraded = page({
            body: '<script src="http://a.test/x.js"></script>',
            finalUrl: 'https://example.com/',
            headers: { 'content-security-policy': "default-src 'self'; upgrade-insecure-requests" },
        });
        expect(await runCheck(byId('mixed_content'), context('https://example.com', upgraded))).toMatchObject({ status: 'pass', evidence: { upgraded: true } });
    });

    it('takes upgrade-insecure-requests from any CSP header policy or from a <meta> policy', async () => {
        const body = '<script src="http://a.test/x.js"></script>';
        const second = page({ body, headers: { 'content-security-policy': "default-src 'self', upgrade-insecure-requests" } });
        expect(await runCheck(byId('mixed_content'), context('https://example.com', second))).toMatchObject({ status: 'pass', evidence: { upgraded: true } });
        const meta = page({ body: `<html><head><meta http-equiv="content-security-policy" content="upgrade-insecure-requests"></head><body>${body}</body></html>` });
        expect(await runCheck(byId('mixed_content'), context('https://example.com', meta))).toMatchObject({ status: 'pass', evidence: { upgraded: true } });
        // Only the directive counts, not the words anywhere in the header.
        const reported = page({ body, headers: { 'content-security-policy': "default-src 'self'; report-uri /upgrade-insecure-requests" } });
        expect((await runCheck(byId('mixed_content'), context('https://example.com', reported))).status).toBe('fail');
    });

    it('has nothing to mix on an http page', async () => {
        expect(await run('<script src="http://a.test/x.js"></script>', 'http://example.com/')).toMatchObject({ status: 'skipped', skippedReason: 'not_applicable' });
    });
});

describe('https', () => {
    const cert = (overrides: Partial<CertificateInfo> = {}): CertificateInfo => ({ authorized: true, error: null, validTo: '2027-01-01T00:00:00.000Z', daysLeft: 90, issuer: 'CA', ...overrides });
    const withCert = (id: string, certificate: CertificateInfo | null) => runCheck(byId(id), { ...context('https://example.com'), certificate });
    const withProbe = (httpProbe: HttpProbe | null) => runCheck(byId('http_redirect'), { ...context('https://example.com'), httpProbe });

    it('judges the certificate by trust and by the days left', async () => {
        expect(await withCert('cert_valid', cert())).toMatchObject({ status: 'pass' });
        expect(await withCert('cert_valid', cert({ authorized: false, error: 'DEPTH_ZERO_SELF_SIGNED_CERT' }))).toMatchObject({
            status: 'fail',
            pointsLost: 8,
            evidence: { error: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
        });
        expect(await withCert('cert_expiry', cert({ daysLeft: 90 }))).toMatchObject({ status: 'pass' });
        // At 20 days an ACME client is mid-renewal: that is healthy.
        expect(await withCert('cert_expiry', cert({ daysLeft: 20 }))).toMatchObject({ status: 'pass' });
        expect(await withCert('cert_expiry', cert({ daysLeft: 10 }))).toMatchObject({ status: 'warn' });
        expect(await withCert('cert_expiry', cert({ daysLeft: 4 }))).toMatchObject({ status: 'fail' });
        expect(await withCert('cert_expiry', cert({ daysLeft: -5 }))).toMatchObject({ status: 'fail' });
    });

    it('fails the certificate when nothing answers with TLS (no expiry to judge then), and is skipped when the certificate was not looked at', async () => {
        expect(await withCert('cert_valid', null)).toMatchObject({ status: 'fail', evidence: { available: false } });
        expect(await withCert('cert_expiry', null)).toMatchObject({ status: 'skipped', pointsLost: 0, skippedReason: 'no_certificate' });
        expect(await runCheck(byId('cert_valid'), context('https://example.com'))).toMatchObject({ status: 'skipped' });
    });

    it('passes when http ends on https or nothing answers on port 80, and fails when http stays http', async () => {
        expect(await withProbe({ finalUrl: 'https://example.com/', status: 200 })).toMatchObject({ status: 'pass' });
        expect(await withProbe(null)).toMatchObject({ status: 'pass', evidence: { answered: false } });
        expect(await withProbe({ finalUrl: 'http://example.com/', status: 200 })).toMatchObject({ status: 'fail', pointsLost: 5 });
        expect(await withProbe({ finalUrl: 'http://example.com/login?session=SECRET', status: 200 })).toMatchObject({ evidence: { finalUrl: 'http://example.com/login?session=…' } });
        expect(await runCheck(byId('http_redirect'), context('https://example.com'))).toMatchObject({ status: 'skipped' });
    });

    it('skips a firewall answer on port 80 and passes a port that refuses plain http (426)', async () => {
        for (const status of [401, 403, 429]) expect(await withProbe({ finalUrl: 'http://example.com/', status }), String(status)).toMatchObject({ status: 'skipped', skippedReason: 'blocked' });
        expect(await withProbe({ finalUrl: 'http://example.com/', status: 426 })).toMatchObject({ status: 'pass', evidence: { status: 426 } });
    });
});

describe('fixGain', () => {
    const result = (checkId: string, status: 'pass' | 'warn' | 'fail' | 'skipped', pointsLost: number, severity: 'high' | 'low'): Parameters<typeof computeScore>[0][number] => ({
        checkId,
        category: 'security',
        layer: 'light',
        status,
        severity,
        effort: 'minutes',
        evidence: {},
        pointsLost,
    });

    it('is the share of the weighted points a check costs, to one decimal', () => {
        const results = [result('a', 'fail', 5, 'high'), result('b', 'warn', 0.5, 'low'), result('c', 'pass', 0, 'high')];
        // total weight of the checks that ran: 5 + 1 + 5 = 11
        expect(fixGain(results, 'a')).toBe(45.5);
        expect(fixGain(results, 'b')).toBe(4.5);
    });

    it('is zero for a passed, skipped or unknown check', () => {
        const results = [result('a', 'fail', 5, 'high'), result('s', 'skipped', 0, 'high'), result('c', 'pass', 0, 'high')];
        expect(fixGain(results, 'c')).toBe(0);
        expect(fixGain(results, 's')).toBe(0);
        expect(fixGain(results, 'nope')).toBe(0);
    });
});

describe('SEO checks on the HTML', () => {
    const run = (id: string, body: string, overrides: Partial<FetchedPage> = {}) => runCheck(byId(id), context('https://example.com', page({ body, ...overrides })));
    it('passes a well-formed page on every check', async () => {
        for (const id of [
            'seo_title',
            'meta_description',
            'h1',
            'viewport',
            'html_lang',
            'canonical',
            'noindex',
            'open_graph',
            'open_graph_quality',
            'twitter_card',
            'heading_order',
            'img_alt',
            'img_dimensions',
            'favicon',
            'json_ld',
        ]) {
            expect(await run(id, GOOD_HTML), id).toMatchObject({ status: 'pass', category: 'seo' });
        }
    });

    it('does not count the title of an inline SVG as a second page title', async () => {
        const body = `<title>${'t'.repeat(40)}</title><svg viewBox="0 0 1 1"><title>Logo</title></svg>`;
        expect(await run('seo_title', body)).toMatchObject({ status: 'pass', evidence: { count: 1 } });
    });

    it('does not judge an error page as if it were the site', async () => {
        for (const id of ['seo_title', 'h1', 'noindex', 'json_ld']) {
            expect(await run(id, '<html></html>', { status: 404 }), id).toMatchObject({ status: 'skipped', skippedReason: 'error_page' });
        }
    });

    it('is skipped on content that is not HTML', async () => {
        expect(await run('seo_title', '{}', { contentType: 'application/json' })).toMatchObject({ status: 'skipped', skippedReason: 'not_html' });
    });

    it('fails a missing title and warns on a short, long or doubled one', async () => {
        expect((await run('seo_title', '<html></html>')).status).toBe('fail');
        expect((await run('seo_title', '<title>Hi</title>')).status).toBe('warn');
        expect((await run('seo_title', `<title>${'t'.repeat(80)}</title>`)).status).toBe('warn');
        expect((await run('seo_title', `<title>${'a'.repeat(40)}</title><title>${'b'.repeat(40)}</title>`)).status).toBe('warn');
        expect((await run('seo_title', `<script>var s = "<title>${'x'.repeat(40)}</title>"</script>`)).status).toBe('fail');
    });

    it('hides comments and scripts in one pass, whichever opens first', async () => {
        const body = `<script>var s = "<!--"</script><title>${'t'.repeat(40)}</title><script>x = "-->"</script>`;
        expect(await run('seo_title', body)).toMatchObject({ status: 'pass', evidence: { count: 1 } });
        expect((await run('seo_title', `<!-- <script> --><title>${'t'.repeat(40)}</title>`)).status).toBe('pass');
    });

    it('stays fast on a huge page of unclosed tags', async () => {
        const huge = (chunk: string) => chunk.repeat(Math.ceil(1_000_000 / chunk.length));
        for (const [id, body] of [
            ['seo_title', huge('<!--')],
            ['seo_title', huge('<script>')],
            ['seo_title', huge('<svg>')],
            ['seo_title', huge('<title>')],
            ['h1', huge('<h1>')],
            ['h1', `<h1>${huge('<')}</h1>`],
            ['meta_description', huge('<meta ')],
            ['meta_description', huge('<meta content="')],
            ['json_ld', huge('<script>')],
            ['heading_order', huge('<h2>')],
            ['h1', `<h1>${huge('<div>')}</h1>`],
            ['h1', `${'<b>'.repeat(500)}${huge('</i>')}`],
            ['img_alt', huge('<span><img>')],
        ] as const) {
            const started = performance.now();
            expect((await run(id, body)).skippedReason, id).not.toBe('check_error');
            // The guard is against a stall of minutes; a loaded CI runner (suites run in parallel) may take several seconds.
            expect(performance.now() - started, `${id} ${body.slice(0, 20)}`).toBeLessThan(10_000);
        }
    }, 60_000); // 13 pages of 1 MB: the default 5 s per test is too short on a loaded CI runner; each page has its own 10 s guard above.

    it('skips a page nested deeper than a browser would build it, instead of stalling on it', async () => {
        expect(await run('h1', `<h1>Title</h1>${'<div>'.repeat(600)}`)).toMatchObject({ status: 'skipped', skippedReason: 'too_deep', evidence: { maxDepth: 512 } });
        expect(await run('h1', `<h1>Title</h1>${'<div>'.repeat(400)}`)).toMatchObject({ status: 'pass' });
    });

    it('reads the description whatever the attribute order, quotes or case', async () => {
        expect(await run('meta_description', `<meta content='${'d'.repeat(100)}' NAME="Description">`)).toMatchObject({ status: 'pass', evidence: { length: 100 } });
        expect((await run('meta_description', '<meta name="description" content="short">')).status).toBe('warn');
        expect((await run('meta_description', '<meta property="og:description" content="x">')).status).toBe('fail');
        expect(await run('meta_description', `<meta content="5 > 3 ${'d'.repeat(100)}" name="description">`)).toMatchObject({ status: 'pass', evidence: { length: 106 } });
        // `name` inside another attribute's value is not the attribute.
        expect((await run('meta_description', `<meta property="og:x" content="site name = description ${'d'.repeat(100)}">`)).status).toBe('fail');
    });

    it('needs one non-empty H1, and does not fail a page cut short', async () => {
        expect((await run('h1', '<h1></h1>')).status).toBe('fail');
        expect((await run('h1', '<h1>A</h1><h1>B</h1>')).status).toBe('warn');
        expect(await run('h1', '<h1><span>Nested</span> heading</h1>')).toMatchObject({ status: 'pass', evidence: { h1: 'Nested heading' } });
        expect(await run('h1', '<p>no heading yet</p>', { truncated: true })).toMatchObject({ status: 'skipped', skippedReason: 'truncated' });
    });

    it('decodes named references and turns impossible numeric ones into U+FFFD, as a browser does', async () => {
        expect(await run('h1', '<h1>A &ndash; B&hellip; &copy; &eacute; &#x110000; &#xD800;</h1>')).toMatchObject({ status: 'pass', evidence: { h1: 'A – B… © é \uFFFD \uFFFD' } });
    });

    it('reads a logo image in a heading by its alt, in both heading checks', async () => {
        expect(await run('h1', '<h1><img src="/logo.svg" alt="Acme"></h1>')).toMatchObject({ status: 'pass', evidence: { h1: 'Acme' } });
        expect(await run('heading_order', '<h1><img src="/logo.svg" alt="Acme"></h1><h2>Sub</h2>')).toMatchObject({ status: 'pass', evidence: { count: 2 } });
        // An empty heading is no heading for either check.
        expect(await run('heading_order', '<h1></h1><h2>Sub</h2>')).toMatchObject({ evidence: { count: 1 } });
    });

    it('wants width=device-width in the viewport, and zoom left on', async () => {
        expect((await run('viewport', '<meta name="viewport" content="width=1024">')).status).toBe('warn');
        expect(await run('viewport', '<meta name="viewport" content="width=device-width, user-scalable=no">')).toMatchObject({ status: 'warn', evidence: { zoomBlocked: true } });
        expect((await run('viewport', '<meta name="viewport" content="width=device-width, maximum-scale=1">')).status).toBe('warn');
        expect((await run('viewport', '<meta name="viewport" content="width=device-width, maximum-scale=5">')).status).toBe('pass');
        expect((await run('viewport', '<html></html>')).status).toBe('fail');
    });

    it('fails a missing lang and does not take data-lang for it', async () => {
        expect((await run('html_lang', '<html data-lang="en">')).status).toBe('fail');
        expect((await run('html_lang', '<html lang="">')).status).toBe('fail');
    });

    it('checks the canonical is present, absolute and names this page', async () => {
        expect((await run('canonical', '<html></html>')).status).toBe('warn');
        expect((await run('canonical', '<link rel="canonical" href="/about">')).status).toBe('warn');
        expect((await run('canonical', '<link rel="canonical" href="https://example.com/other">')).status).toBe('warn');
        expect((await run('canonical', '<link href="https://example.com" rel="canonical">')).status).toBe('pass');
        expect((await run('canonical', '<link rel="alternate canonical" href="https://example.com/#top">')).status).toBe('pass');
    });

    it('ignores tracking parameters of the scanned address unless the canonical names a query', async () => {
        const tracked = { finalUrl: 'https://example.com/?utm_source=x' };
        expect((await run('canonical', '<link rel="canonical" href="https://example.com/">', tracked)).status).toBe('pass');
        expect((await run('canonical', '<link rel="canonical" href="https://example.com/?page=2">', tracked)).status).toBe('warn');
        expect((await run('hreflang', '<link rel="alternate" hreflang="en" href="https://example.com/">', tracked)).status).toBe('pass');
    });

    it('warns on several different canonicals', async () => {
        expect(await run('canonical', '<link rel="canonical" href="https://example.com/"><link rel="canonical" href="https://example.com/a">')).toMatchObject({
            status: 'warn',
            evidence: { conflicting: true },
        });
        expect((await run('canonical', '<link rel="canonical" href="https://example.com/"><link rel="canonical" href="https://example.com/">')).status).toBe('pass');
    });

    it('fails noindex in the meta tag or in the header', async () => {
        expect(await run('noindex', '<meta name="robots" content="index, noindex">')).toMatchObject({ status: 'fail', evidence: { meta: true, header: false } });
        expect(await run('noindex', '', { headers: { 'x-robots-tag': 'noindex, nofollow' } })).toMatchObject({ status: 'fail', evidence: { header: true } });
        expect((await run('noindex', '<meta name="robots" content="nofollow">')).status).toBe('pass');
        expect((await run('noindex', '<!-- <meta name="robots" content="noindex"> -->')).status).toBe('pass');
    });

    it('reads none, every robots or googlebot meta tag, and a header aimed at Googlebot', async () => {
        expect((await run('noindex', '<meta name="robots" content="none">')).status).toBe('fail');
        expect((await run('noindex', '<meta name="robots" content="index"><meta name="googlebot" content="noindex">')).status).toBe('fail');
        expect((await run('noindex', '<meta name="robots" content="nonetheless">')).status).toBe('pass');
        const header = async (value: string) => (await run('noindex', '', { headers: { 'x-robots-tag': value } })).status;
        expect(await header('googlebot: noindex')).toBe('fail');
        expect(await header('none')).toBe('fail');
        expect(await header('otherbot: noindex')).toBe('pass');
        expect(await header('otherbot: nofollow, googlebot: noindex')).toBe('fail');
        expect(await header('unavailable_after: 25 Jun 2030 15:00:00 PST, noindex')).toBe('fail');
    });

    it('counts the Open Graph tags that are there', async () => {
        expect(await run('open_graph', '<meta property="og:title" content="T"><meta property="og:image" content="https://x/i.png">')).toMatchObject({
            status: 'warn',
            evidence: { present: 2, missing: 'og:description, og:url' },
        });
        expect((await run('open_graph', '<html></html>')).status).toBe('fail');
        expect((await run('twitter_card', '<html></html>')).status).toBe('warn');
    });

    it('checks the Open Graph details only where there is Open Graph', async () => {
        expect(await run('open_graph_quality', '<html></html>')).toMatchObject({ status: 'skipped', skippedReason: 'not_applicable' });
        expect(await run('open_graph_quality', '<meta property="og:title" content="T"><meta property="og:image" content="/i.png">')).toMatchObject({
            status: 'warn',
            evidence: { missing: 'og:type, og:site_name, og:locale, og:image:alt', imageAbsolute: false },
        });
        expect((await run('twitter_card', '<meta name="twitter:card" content="summary_large_image">')).status).toBe('pass');
    });

    it('flags a skipped heading level but not a page without headings', async () => {
        expect(await run('heading_order', '<h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2>')).toMatchObject({ status: 'pass', evidence: { skips: 0 } });
        expect(await run('heading_order', '<h1>a</h1><h3>c</h3>')).toMatchObject({ status: 'warn', evidence: { skips: 1 } });
        expect(await run('heading_order', '<p>x</p>')).toMatchObject({ status: 'skipped', skippedReason: 'no_headings' });
    });

    it('accepts an ARIA label as a text alternative and a presentation role or aria-hidden as decoration', async () => {
        const body = '<img src="a" aria-label="Logo"><img src="b" aria-labelledby="cap"><img src="c" role="presentation"><img src="d" role="none"><img src="e" aria-hidden="true">';
        expect(await run('img_alt', body)).toMatchObject({ status: 'pass', evidence: { images: 5, missing: 0 } });
        expect(await run('img_alt', '<img src="a" aria-label=""><img src="b" aria-hidden="false"><img src="c" role="img">')).toMatchObject({ evidence: { missing: 3 } });
    });

    it('accepts an empty alt as decoration and fails mostly-missing alt text', async () => {
        expect((await run('img_alt', '<img src="a.png" alt=""><img src="b.png" alt="B"><img src="c.png" data-alt="x">')).status).toBe('warn');
        expect(await run('img_alt', '<img src="a.png"><img src="b.png"><img src="c.png" alt="C">')).toMatchObject({ status: 'fail', evidence: { images: 3, missing: 2 } });
        expect((await run('img_alt', '<p>no images</p>')).status).toBe('pass');
        expect((await run('img_alt', '<noscript><img src="a.png"></noscript>')).status).toBe('pass');
        // `alt` inside an address or another attribute is not the attribute.
        expect(await run('img_alt', '<img src="https://cdn/x/alt/a.png"><img title="no alt">')).toMatchObject({ evidence: { missing: 2 } });
    });

    it('wants images to say their size, and does not apply without images', async () => {
        expect(await run('img_dimensions', '<img src="a.png" width="1" height="1"><img src="b.png" style="aspect-ratio: 1"><img src="data:,">')).toMatchObject({
            status: 'pass',
            evidence: { images: 2 },
        });
        expect(await run('img_dimensions', '<img src="a.png" width="1"><img src="b.png" width="1" height="1">')).toMatchObject({ status: 'warn', evidence: { missing: 1 } });
        expect(await run('img_dimensions', '<p>no images</p>')).toMatchObject({ status: 'skipped', skippedReason: 'not_applicable' });
    });

    it('finds the icon whatever the rel spelling', async () => {
        expect((await run('favicon', '<link rel="shortcut icon" href="/f.ico">')).status).toBe('pass');
        expect((await run('favicon', '<link rel=icon href=data:,>')).status).toBe('pass');
        expect((await run('favicon', '<link rel="stylesheet" href="/a.css">')).status).toBe('warn');
    });

    it('reads JSON-LD out of a script and fails broken JSON', async () => {
        expect(await run('json_ld', '<script type="application/ld+json">{"@type":"Org"}</script>')).toMatchObject({ status: 'pass', evidence: { blocks: 1, types: 'Org' } });
        expect(await run('json_ld', '<script type="application/ld+json">{"@type":</script>')).toMatchObject({ status: 'fail', evidence: { invalid: 1 } });
        expect((await run('json_ld', '<script>var a = 1</script>')).status).toBe('warn');
        expect((await run('json_ld', '<!-- <script type="application/ld+json">{</script> -->')).status).toBe('warn');
    });

    it('lists the JSON-LD types, warns on an item without one, and marks retired ones without judging them', async () => {
        const block = (json: string) => `<script type="application/ld+json">${json}</script>`;
        expect(await run('json_ld', block('{"@graph":[{"@type":"WebSite"},{"@type":["Organization","Brand"]}]}'))).toMatchObject({
            status: 'pass',
            evidence: { types: 'WebSite, Organization, Brand', untyped: 0 },
        });
        expect(await run('json_ld', block('{"@context":"https://schema.org","name":"x"}'))).toMatchObject({ status: 'warn', evidence: { untyped: 1 } });
        expect(await run('json_ld', block('[{"@type":"HowTo"},{"@type":"FAQPage"}]'))).toMatchObject({ status: 'pass', evidence: { retired: 'HowTo' } });
    });

    it('does not apply hreflang to a single-language site and checks the set when there is one', async () => {
        expect(await run('hreflang', '<html></html>')).toMatchObject({ status: 'skipped', skippedReason: 'not_applicable' });
        const set =
            '<link rel="alternate" hreflang="en" href="https://example.com/"><link rel="alternate" hreflang="cs" href="https://example.com/cs/"><link rel="alternate" hreflang="x-default" href="https://example.com/">';
        expect((await run('hreflang', set)).status).toBe('pass');
        expect((await run('hreflang', '<link rel="alternate" hreflang="cs" href="https://example.com/cs/">')).status).toBe('warn');
        expect((await run('hreflang', '<link rel="alternate" hreflang="english!" href="/en">')).status).toBe('warn');
    });
});

const IDNES_ARTICLE = 'https://www.idnes.cz/zpravy/domaci/clanek.A251010_1';

// What idnes.cz does: every article redirects (302, 302) to a consent page that carries the article's address.
const consentWallPage = (finalUrl = `https://www.idnes.cz/nastaveni-souhlasu?url=${encodeURIComponent(IDNES_ARTICLE)}`): FetchedPage =>
    page({
        finalUrl,
        redirects: [
            { from: IDNES_ARTICLE, to: 'https://www.idnes.cz/zpravy/domaci/clanek.A251010_1?x', status: 302 },
            { from: 'https://www.idnes.cz/zpravy/domaci/clanek.A251010_1?x', to: finalUrl, status: 302 },
        ],
        headers: { 'strict-transport-security': 'max-age=31536000' },
        body: '<html><head><title>Nastavení souhlasu</title></head><body><img src="http://cdn.example/x.png"></body></html>',
    });

describe('indexingOf', () => {
    it('reads noindex from the meta tag or the header, and makes the canonical absolute', async () => {
        expect(await indexingOf(page({ body: '<meta name="robots" content="noindex"><link rel="canonical" href="/a">' }))).toEqual({ noindex: true, canonical: 'https://example.com/a' });
        expect(await indexingOf(page({ contentType: 'application/pdf', headers: { 'x-robots-tag': 'noindex' } }))).toEqual({ noindex: true, canonical: null });
        expect(await indexingOf(page({ body: GOOD_HTML }))).toEqual({ noindex: false, canonical: 'https://example.com/' });
    });
});

describe('consent wall', () => {
    it('skips the content checks on a consent page the article redirected to, and keeps judging the headers', async () => {
        const wall = consentWallPage();
        for (const id of ['html_lang', 'canonical', 'seo_title', 'img_alt', 'mixed_content']) {
            expect(await runCheck(byId(id), context(IDNES_ARTICLE, wall)), id).toMatchObject({
                status: 'skipped',
                skippedReason: 'consent_wall',
                evidence: { finalUrl: hideQueryValues(wall.finalUrl) },
            });
        }
        expect((await runCheck(byId('hsts'), context(IDNES_ARTICLE, wall))).status).toBe('pass');
    });

    it('sees a wall by the requested address in the query, even when the path names nothing', async () => {
        const wall = consentWallPage(`https://www.idnes.cz/brana?ret=${encodeURIComponent(IDNES_ARTICLE)}`);
        expect((await runCheck(byId('html_lang'), context(IDNES_ARTICLE, wall))).skippedReason).toBe('consent_wall');
    });

    it('sees a wall on a consent subdomain, and on another site when it carries the asked address back', async () => {
        const onCmp = consentWallPage(`https://cmp.idnes.cz/nastaveni-souhlasu?x=1`);
        expect((await runCheck(byId('html_lang'), context(IDNES_ARTICLE, onCmp))).skippedReason).toBe('consent_wall');
        const elsewhere = consentWallPage(`https://consent.example-cmp.com/collect?done=${encodeURIComponent(IDNES_ARTICLE)}`);
        expect((await runCheck(byId('html_lang'), context(IDNES_ARTICLE, elsewhere))).skippedReason).toBe('consent_wall');
    });

    it('calls a sign-in page that carries the asked address back a login wall, not a consent wall', async () => {
        const reason = async (finalUrl: string, input = IDNES_ARTICLE) => (await runCheck(byId('html_lang'), context(input, consentWallPage(finalUrl)))).skippedReason;
        const back = encodeURIComponent(IDNES_ARTICLE);
        expect(await reason(`https://sso.idnes.cz/?service=${back}`)).toBe('login_wall');
        expect(await reason(`https://www.idnes.cz/login?next=${back}`)).toBe('login_wall');
        expect(await reason(`https://auth.example.org/oauth2/authorize?redirect_uri=${back}`)).toBe('login_wall');
        // A consent page on an auth-named host is still a consent wall.
        expect(await reason(`https://auth.idnes.cz/consent?return_to=${back}`)).toBe('consent_wall');
        // Asking for the sign-in page itself is no wall.
        const login = 'https://www.idnes.cz/login';
        expect((await runCheck(byId('html_lang'), context(login, consentWallPage(`https://sso.idnes.cz/login?service=${encodeURIComponent(login)}`)))).status).toBe('fail');
    });

    it('takes an ordinary redirect, another site, or a cookie page that was asked for as the page itself', async () => {
        const redirected = (from: string, finalUrl: string) => page({ finalUrl, redirects: [{ from, to: finalUrl, status: 301 }], body: '<html><body></body></html>' });
        expect((await runCheck(byId('html_lang'), context('https://example.com/', redirected('https://example.com/', 'https://example.com/en/')))).status).toBe('fail');
        expect((await runCheck(byId('html_lang'), context('https://example.com/cookies', redirected('https://example.com/cookies', 'https://example.com/cookies-policy')))).status).toBe('fail');
        expect((await runCheck(byId('html_lang'), context('https://example.com/', redirected('https://example.com/', 'https://consent.other.com/')))).status).toBe('fail');
        // Not redirected at all: a page whose own address names consent is the page.
        expect((await runCheck(byId('html_lang'), context('https://example.com/gdpr', page({ finalUrl: 'https://example.com/gdpr', body: '<html></html>' })))).status).toBe('fail');
    });
});

describe('SEO checks on the site files', () => {
    const file = (overrides: Partial<SiteFile> = {}): SiteFile => ({ url: 'https://example.com/robots.txt', status: 200, contentType: 'text/plain', body: '', truncated: false, ...overrides });
    const withContext = (id: string, extra: Partial<CheckContext>) => runCheck(byId(id), { ...context('https://example.com', page({ body: GOOD_HTML })), ...extra });
    const GOOD_ROBOTS = 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml';
    const GOOD_SITEMAP = '<urlset><url><loc>https://example.com/</loc></url></urlset>';

    it('is skipped when a file could not be reached and fails loudly when the check had nothing to read', async () => {
        expect(await withContext('robots_txt', { robots: null })).toMatchObject({ status: 'skipped', skippedReason: 'unreachable' });
        expect(await withContext('robots_txt', {})).toMatchObject({ status: 'skipped', skippedReason: 'check_error' });
    });

    it('passes a robots.txt that answers, warns when it is missing and fails on a server error', async () => {
        expect(await withContext('robots_txt', { robots: file({ body: GOOD_ROBOTS }) })).toMatchObject({ status: 'pass', severity: 'medium', evidence: { blocksAll: false, sitemaps: 1 } });
        expect((await withContext('robots_txt', { robots: file({ status: 404, body: 'Not found' }) })).status).toBe('warn');
        expect((await withContext('robots_txt', { robots: file({ contentType: 'text/html', body: '<!doctype html><html>app</html>' }) })).status).toBe('warn');
        expect((await withContext('robots_txt', { robots: file({ contentType: 'text/plain', body: '\uFEFF  <html><body>app</body></html>' }) })).status).toBe('warn');
        // A real file served with the wrong type is still the file.
        expect((await withContext('robots_txt', { robots: file({ contentType: 'text/html', body: GOOD_ROBOTS }) })).status).toBe('pass');
        // Blocking is `robots_allows_page`'s finding.
        expect(await withContext('robots_txt', { robots: file({ body: 'User-agent: *\nDisallow: /' }) })).toMatchObject({ status: 'pass', evidence: { blocksAll: true } });
        expect((await withContext('robots_txt', { robots: file({ status: 503 }) })).status).toBe('fail');
    });

    it('fails, as a critical check, when robots.txt keeps Googlebot off the scanned page', async () => {
        const verdict = (body: string, input = 'https://example.com') =>
            runCheck(byId('robots_allows_page'), { ...context(input, page({ finalUrl: input, body: GOOD_HTML })), robots: file({ body }) });
        expect(await verdict('User-agent: *\nDisallow: /')).toMatchObject({ status: 'fail', severity: 'critical', evidence: { path: '/', rule: 'Disallow: /' } });
        expect((await verdict(GOOD_ROBOTS)).status).toBe('pass');
        expect((await verdict('User-agent: *\nDisallow: /private', 'https://example.com/private/a')).status).toBe('fail');
        expect((await verdict('User-agent: *\nDisallow: /private', 'https://example.com/public')).status).toBe('pass');
        expect((await verdict('User-agent: *\nDisallow: /*?q=', 'https://example.com/search?q=x')).status).toBe('fail');
        // A pasted link with ad tracking is judged as the address a crawler requests, without it.
        expect((await verdict('User-agent: *\nDisallow: /*?', 'https://example.com/?utm_source=fb&gclid=1')).status).toBe('pass');
        expect((await verdict('User-agent: *\nDisallow: /*?', 'https://example.com/?page=2&utm_source=fb')).status).toBe('fail');
    });

    it('never shows the values of the scanned query in the public evidence', async () => {
        const verdict = (body: string, input: string) => runCheck(byId('robots_allows_page'), { ...context(input, page({ finalUrl: input, body: GOOD_HTML })), robots: file({ body }) });
        const result = await verdict('User-agent: *\nDisallow: /reset', 'https://example.com/reset?token=SECRET&lang=en');
        expect(result).toMatchObject({ status: 'fail', evidence: { path: '/reset?token=…&lang=…' } });
        expect(JSON.stringify(result)).not.toContain('SECRET');
        expect((await runCheck(byId('robots_allows_page'), { ...context('https://example.com', page()), robots: file({ status: 404 }) })).skippedReason).toBe('no_robots');
        expect((await runCheck(byId('robots_allows_page'), { ...context('https://example.com', page()), robots: file({ status: 503 }) })).skippedReason).toBe('robots_error');
    });

    it('checks the sitemap exists, is XML and lists addresses', async () => {
        const sitemap = (overrides: Partial<SiteFile>) => file({ url: 'https://example.com/sitemap.xml', contentType: 'application/xml', ...overrides });
        expect(await withContext('sitemap_xml', { sitemap: sitemap({ body: GOOD_SITEMAP }) })).toMatchObject({ status: 'pass', evidence: { kind: 'urlset', addresses: 1 } });
        expect((await withContext('sitemap_xml', { sitemap: sitemap({ status: 404 }) })).status).toBe('warn');
        expect((await withContext('sitemap_xml', { sitemap: sitemap({ contentType: 'text/html', body: `<?xml version="1.0"?>${GOOD_SITEMAP}` }) })).status).toBe('pass');
        expect((await withContext('sitemap_xml', { sitemap: sitemap({ body: 'plain text' }) })).status).toBe('fail');
        expect((await withContext('sitemap_xml', { sitemap: sitemap({ body: '<urlset></urlset>' }) })).status).toBe('warn');
        expect((await withContext('sitemap_xml', { sitemap: sitemap({ url: 'https://example.com/sitemap.xml.gz' }) })).skippedReason).toBe('compressed');
        // A missing root end fails only a file read whole; a cut-off one keeps what was read.
        expect((await withContext('sitemap_xml', { sitemap: sitemap({ body: '<urlset><url><loc>https://example.com/</loc></url>' }) })).status).toBe('fail');
        expect((await withContext('sitemap_xml', { sitemap: sitemap({ body: '<urlset><url><loc>https://example.com/</loc></url>', truncated: true }) })).status).toBe('pass');
    });

    it('warns on sitemap addresses on another site or on http, and counts lastmod without judging it', async () => {
        const sitemap = (body: string) => ({ sitemap: file({ url: 'https://example.com/sitemap.xml', contentType: 'application/xml', body }) });
        expect(await withContext('sitemap_xml', sitemap('<urlset><url><loc>https://www.example.com/</loc><lastmod>2026-01-01</lastmod></url></urlset>'))).toMatchObject({
            status: 'pass',
            evidence: { foreign: 0, insecure: 0, lastmod: 1 },
        });
        expect(await withContext('sitemap_xml', sitemap('<urlset><url><loc>https://other.com/</loc></url><url><loc>/relative</loc></url></urlset>'))).toMatchObject({
            status: 'warn',
            evidence: { foreign: 2 },
        });
        expect(await withContext('sitemap_xml', sitemap('<urlset><url><loc>http://example.com/</loc></url></urlset>'))).toMatchObject({ status: 'warn', evidence: { insecure: 1 } });
    });

    it('does not take a firewall turning the scanner away for a missing file', async () => {
        expect((await withContext('robots_txt', { robots: file({ status: 403 }) })).skippedReason).toBe('blocked');
        expect((await withContext('sitemap_xml', { sitemap: file({ url: 'https://example.com/sitemap.xml', status: 429 }) })).skippedReason).toBe('blocked');
        expect((await withContext('soft_404', { notFound: { url: 'https://example.com/x', finalUrl: 'https://example.com/x', status: 403 } })).skippedReason).toBe('blocked');
    });

    it('wants the sitemap named in robots.txt', async () => {
        expect((await withContext('sitemap_in_robots', { robots: file({ body: GOOD_ROBOTS }) })).status).toBe('pass');
        expect((await withContext('sitemap_in_robots', { robots: file({ body: 'User-agent: *\nDisallow:' }) })).status).toBe('warn');
        expect((await withContext('sitemap_in_robots', { robots: file({ status: 404 }) })).skippedReason).toBe('no_robots');
    });

    it('judges the sitemap sample by how many of its pages answer', async () => {
        const sample = (...statuses: number[]) => ({ sitemapSample: statuses.map((status, index) => ({ url: `https://example.com/p${index}`, status })) });
        expect((await withContext('sitemap_urls', sample(200, 200, 200))).status).toBe('pass');
        expect(await withContext('sitemap_urls', sample(200, 200, 404))).toMatchObject({ status: 'warn', evidence: { failing: 1, example: 'https://example.com/p2' } });
        expect((await withContext('sitemap_urls', sample(404, 0, 200))).status).toBe('fail');
        expect((await withContext('sitemap_urls', sample())).skippedReason).toBe('no_sample');
    });

    it('does not count a firewall answer as a dead page, and warns on a redirecting one', async () => {
        const sample = (...statuses: number[]) => ({ sitemapSample: statuses.map((status, index) => ({ url: `https://example.com/p${index}`, status })) });
        expect(await withContext('sitemap_urls', sample(200, 403, 429))).toMatchObject({ status: 'pass', evidence: { sampled: 1, blocked: 2 } });
        expect((await withContext('sitemap_urls', sample(403, 429))).skippedReason).toBe('blocked');
        const redirecting = {
            sitemapSample: [
                { url: 'https://example.com/a', status: 200 },
                { url: 'https://example.com/b', status: 200, redirected: true },
            ],
        };
        expect(await withContext('sitemap_urls', redirecting)).toMatchObject({ status: 'warn', evidence: { redirected: 1, example: 'https://example.com/b' } });
    });

    it('warns on sampled pages that are noindex or name another canonical: they do not belong in a sitemap', async () => {
        const sitemapSample = [
            { url: 'https://example.com/a', status: 200, noindex: false, canonical: 'https://example.com/a/' },
            { url: 'https://example.com/b', status: 200, noindex: true, canonical: null },
            { url: 'https://example.com/c?x=1', status: 200, noindex: false, canonical: 'https://example.com/c' },
        ];
        expect(await withContext('sitemap_urls', { sitemapSample })).toMatchObject({ status: 'warn', evidence: { unindexable: 2, example: 'https://example.com/b' } });
        expect((await withContext('sitemap_urls', { sitemapSample: sitemapSample.slice(0, 1) })).status).toBe('pass');
    });

    it('does not count redirects of the sample as a fault when the page hit a consent wall, but still counts dead pages', async () => {
        const wall = consentWallPage();
        const sitemapSample = [
            { url: 'https://www.idnes.cz/a', status: 200, redirected: true },
            { url: 'https://www.idnes.cz/b', status: 200, redirected: true },
            { url: 'https://www.idnes.cz/c', status: 200, redirected: true },
        ];
        const walled = { ...context(IDNES_ARTICLE, wall), sitemapSample };
        expect(await runCheck(byId('sitemap_urls'), walled)).toMatchObject({ status: 'pass', evidence: { redirected: 0 } });
        expect((await runCheck(byId('sitemap_urls'), { ...walled, sitemapSample: [...sitemapSample, { url: 'https://www.idnes.cz/d', status: 404 }] })).status).toBe('warn');
    });

    it('counts redirect hops and flags a temporary one', async () => {
        const hop = (status: number) => ({ from: 'https://a.com/', to: 'https://b.com/', status });
        const chain = (...statuses: number[]) => runCheck(byId('redirect_chain'), context('https://example.com', page({ redirects: statuses.map(hop) })));
        expect((await chain()).status).toBe('pass');
        expect((await chain(301)).status).toBe('pass');
        expect((await chain(302)).status).toBe('warn');
        // http to https, then to `www`: normal.
        expect((await chain(301, 301)).status).toBe('pass');
        expect((await chain(301, 301, 301)).status).toBe('warn');
        expect(await chain(301, 301, 301, 301)).toMatchObject({ status: 'fail', evidence: { hops: 4 } });
    });

    it('passes a temporary last hop that stays on the host (a language pick), and warns on one elsewhere or mid-chain', async () => {
        const run = (...hops: [string, string, number][]) =>
            runCheck(byId('redirect_chain'), context('https://example.com', page({ redirects: hops.map(([from, to, status]) => ({ from, to, status })) })));
        expect(await run(['https://example.com/', 'https://example.com/cs/', 302])).toMatchObject({ status: 'pass', evidence: { temporary: false } });
        expect((await run(['https://www.example.com/', 'https://example.com/', 301], ['https://example.com/', 'https://example.com/cs/', 307])).status).toBe('pass');
        expect((await run(['https://example.com/', 'https://www.example.com/', 302])).status).toBe('warn');
        expect((await run(['https://example.com/', 'https://example.com/a', 302], ['https://example.com/a', 'https://www.example.com/a', 301])).status).toBe('warn');
    });

    it('fails a missing page that answers 200, including after a redirect to the home page', async () => {
        const probe = (status: number) => ({ notFound: { url: 'https://example.com/x', finalUrl: 'https://example.com/', status } });
        expect((await withContext('soft_404', probe(404))).status).toBe('pass');
        expect((await withContext('soft_404', probe(410))).status).toBe('pass');
        expect((await withContext('soft_404', probe(403))).skippedReason).toBe('blocked');
        expect((await withContext('soft_404', probe(200))).status).toBe('fail');
        expect((await withContext('soft_404', probe(500))).status).toBe('warn');
    });

    it('only warns when the missing page is sent to another page (a login wall), not to the home page', async () => {
        const sentToLogin = { notFound: { url: 'https://example.com/x', finalUrl: 'https://example.com/login?next=%2Fx', status: 200 } };
        expect(await withContext('soft_404', sentToLogin)).toMatchObject({ status: 'warn', evidence: { redirected: true } });
        expect((await withContext('soft_404', { notFound: { url: 'https://example.com/x', finalUrl: 'https://example.com/x', status: 200 } })).status).toBe('fail');
    });

    it('fails a redirect that only adds a slash, or lands on a localised home page', async () => {
        const sentTo = (finalUrl: string) => ({ notFound: { url: 'https://example.com/x', finalUrl, status: 200 } });
        expect((await withContext('soft_404', sentTo('https://example.com/x/'))).status).toBe('fail');
        expect((await withContext('soft_404', sentTo('https://example.com/en/'))).status).toBe('fail');
        expect((await withContext('soft_404', sentTo('https://example.com/cs'))).status).toBe('fail');
        expect((await withContext('soft_404', sentTo('https://example.com/pt-BR/'))).status).toBe('fail');
        expect((await withContext('soft_404', sentTo('https://example.com/blog/'))).status).toBe('warn');
    });

    it('passes when the other host name ends on the same host and warns when both live', async () => {
        const variant = (finalUrl: string, status = 200) => ({ hostVariant: { url: 'https://www.example.com/', finalUrl, status } });
        expect((await withContext('canonical_host', variant('https://example.com/'))).status).toBe('pass');
        expect(await withContext('canonical_host', variant('https://www.example.com/'))).toMatchObject({ status: 'warn', evidence: { count: 2 } });
        // The other name does not answer at all: only one address is live.
        expect((await withContext('canonical_host', variant('https://www.example.com/', 502))).status).toBe('pass');
        expect((await withContext('canonical_host', { hostVariant: null })).status).toBe('pass');
        // http that stays on the same host is not this check's business (`http_redirect` reports it).
        expect((await withContext('canonical_host', { httpProbe: { finalUrl: 'http://example.com/', status: 200 } })).status).toBe('pass');
        // An http answer that is an error is not a live second address.
        expect((await withContext('canonical_host', { httpProbe: { finalUrl: 'http://www.example.com/', status: 503 } })).status).toBe('pass');
    });
});

describe('agent discovery checks (bonus signals)', () => {
    const file = (path: string, overrides: Partial<SiteFile> = {}): SiteFile => ({
        url: `https://example.com${path}`,
        status: 200,
        contentType: 'application/json',
        body: '{}',
        truncated: false,
        ...overrides,
    });
    const run = (id: string, agentFiles: Record<string, SiteFile | null> | undefined, withPage: FetchedPage = page({ body: GOOD_HTML })) =>
        runCheck(byId(id), { ...context('https://example.com', withPage), ...(agentFiles === undefined ? {} : { agentFiles }) });
    const CATALOG = '/.well-known/api-catalog';
    const RESOURCE = '/.well-known/oauth-protected-resource';
    const CARD = '/.well-known/agent-card.json';

    it('are never penalised for a file that is not there: not offered, an HTML fallback is no file, a firewall is not judged', async () => {
        for (const [id, path] of [
            ['api_catalog', CATALOG],
            ['oauth_resource', RESOURCE],
            ['a2a_agent_card', CARD],
        ] as const) {
            expect(await run(id, { [path]: file(path, { status: 404 }) }), id).toMatchObject({ status: 'skipped', skippedReason: 'not_offered', pointsLost: 0 });
            expect(await run(id, { [path]: file(path, { body: '<!doctype html><html></html>', contentType: 'text/html' }) }), id).toMatchObject({ status: 'skipped', skippedReason: 'not_offered' });
            expect(await run(id, { [path]: file(path, { status: 403 }) }), id).toMatchObject({ status: 'skipped', skippedReason: 'blocked' });
            expect(await run(id, { [path]: null }), id).toMatchObject({ status: 'skipped', skippedReason: 'unreachable' });
        }
        expect(await run('api_catalog', undefined)).toMatchObject({ status: 'skipped', skippedReason: 'check_error' });
    });

    it('api_catalog: a JSON linkset passes, a file that is not one only warns', async () => {
        const linkset = JSON.stringify({ linkset: [{ anchor: 'https://example.com/.well-known/api-catalog', item: [{ href: 'https://example.com/api' }] }] });
        expect(await run('api_catalog', { [CATALOG]: file(CATALOG, { body: linkset }) })).toMatchObject({ status: 'pass', evidence: { entries: 1 } });
        expect(await run('api_catalog', { [CATALOG]: file(CATALOG, { body: '{"apis": []}' }) })).toMatchObject({ status: 'warn', evidence: { valid: false } });
        expect(await run('api_catalog', { [CATALOG]: file(CATALOG, { body: 'not json' }) })).toMatchObject({ status: 'warn' });
        expect(await run('api_catalog', { [CATALOG]: file(CATALOG, { body: '{"linkset": []}' }) })).toMatchObject({ status: 'warn' });
    });

    it('oauth_resource needs the `resource` field, and a2a_agent_card a name and its skills', async () => {
        expect(await run('oauth_resource', { [RESOURCE]: file(RESOURCE, { body: '{"resource": "https://example.com/api"}' }) })).toMatchObject({ status: 'pass' });
        expect(await run('oauth_resource', { [RESOURCE]: file(RESOURCE, { body: '{"authorization_servers": []}' }) })).toMatchObject({ status: 'warn' });
        expect(await run('a2a_agent_card', { [CARD]: file(CARD, { body: '{"name": "Acme", "skills": []}' }) })).toMatchObject({ status: 'pass' });
        expect(await run('a2a_agent_card', { [CARD]: file(CARD, { body: '{"name": "Acme"}' }) })).toMatchObject({ status: 'warn' });
    });

    it('link_headers: a Link header with an API catalog or service relation passes, otherwise not offered', async () => {
        const withLink = (link: string) => page({ body: GOOD_HTML, headers: { link } });
        expect(await run('link_headers', {}, withLink('</.well-known/api-catalog>; rel="api-catalog"'))).toMatchObject({ status: 'pass', evidence: { relations: 'api-catalog' } });
        expect(await run('link_headers', {}, withLink('<https://example.com/spec>; rel=service-desc, <https://example.com/docs>; rel="service-doc"'))).toMatchObject({
            status: 'pass',
            evidence: { relations: 'service-desc, service-doc' },
        });
        expect(await run('link_headers', {}, withLink('<https://example.com/>; rel="canonical"'))).toMatchObject({ status: 'skipped', skippedReason: 'not_offered' });
        expect(await run('link_headers', {}, page({ body: GOOD_HTML }))).toMatchObject({ status: 'skipped', skippedReason: 'not_offered' });
        expect(await run('link_headers', {}, page({ status: 403 }))).toMatchObject({ status: 'skipped', skippedReason: 'blocked' });
    });
});

describe('agent checks', () => {
    const file = (overrides: Partial<SiteFile> = {}): SiteFile => ({ url: 'https://example.com/llms.txt', status: 200, contentType: 'text/plain', body: '', truncated: false, ...overrides });
    const markdown = (overrides: Partial<MarkdownProbe> = {}): MarkdownProbe => ({
        ...file({ url: 'https://example.com/', contentType: 'text/markdown; charset=utf-8', body: '# Home' }),
        vary: 'Accept',
        ...overrides,
    });
    const withContext = (id: string, extra: Partial<CheckContext>, withPage: FetchedPage = page({ body: GOOD_HTML })) => runCheck(byId(id), { ...context('https://example.com', withPage), ...extra });

    it('are skipped when a file could not be reached, and fail loudly when the check had nothing to read', async () => {
        expect(await withContext('llms_txt', { llms: null })).toMatchObject({ status: 'skipped', skippedReason: 'unreachable' });
        expect(await withContext('llms_txt', {})).toMatchObject({ status: 'skipped', skippedReason: 'check_error' });
        expect(await withContext('markdown_negotiation', { markdown: null })).toMatchObject({ status: 'skipped', skippedReason: 'unreachable' });
        expect(await withContext('ai_crawlers', { robots: null })).toMatchObject({ status: 'skipped', skippedReason: 'unreachable' });
    });

    it('read llms.txt: a titled file passes, a missing one or an HTML fallback warns, a firewall is not judged', async () => {
        expect(await withContext('llms_txt', { llms: file({ body: '# Acme\n\n> Shop\n\n## Docs\n- [Guide](https://example.com/guide.md): how to' }) })).toMatchObject({
            status: 'pass',
            evidence: { present: true, hasTitle: true, links: 1 },
        });
        expect((await withContext('llms_txt', { llms: file({ body: '\uFEFF# Acme' }) })).status).toBe('pass');
        expect((await withContext('llms_txt', { llms: file({ body: 'Welcome to our shop' }) })).status).toBe('warn');
        expect(await withContext('llms_txt', { llms: file({ body: '# Acme\n\n- [Guide](/guide.md)' }) })).toMatchObject({ status: 'warn', evidence: { links: 1, relative: 1 } });
        expect((await withContext('llms_txt', { llms: file({ status: 404, body: 'Not found' }) })).status).toBe('warn');
        expect((await withContext('llms_txt', { llms: file({ contentType: 'text/html', body: '<!doctype html><html>app</html>' }) })).status).toBe('warn');
        expect((await withContext('llms_txt', { llms: file({ status: 403 }) })).skippedReason).toBe('blocked');
    });

    it('wants Markdown on request with a Vary header, or an advertised alternate, and only warns without', async () => {
        expect(await withContext('markdown_negotiation', { markdown: markdown() })).toMatchObject({ status: 'pass', evidence: { served: true, varyAccept: true } });
        expect(await withContext('markdown_negotiation', { markdown: markdown({ vary: null }) })).toMatchObject({ status: 'warn', evidence: { served: true, varyAccept: false } });
        expect((await withContext('markdown_negotiation', { markdown: markdown({ vary: 'Accept-Encoding, Accept' }) })).status).toBe('pass');
        // `Accept-Encoding` alone is not `Accept`.
        expect((await withContext('markdown_negotiation', { markdown: markdown({ vary: 'Accept-Encoding' }) })).status).toBe('warn');
        const html = markdown({ contentType: 'text/html', body: '<html></html>' });
        expect((await withContext('markdown_negotiation', { markdown: html })).status).toBe('warn');
        const alternate = page({ body: GOOD_HTML.replace('</head>', '<link rel="alternate" type="text/markdown" href="/index.md"></head>') });
        expect(await withContext('markdown_negotiation', { markdown: html }, alternate)).toMatchObject({ status: 'pass', evidence: { alternate: '/index.md' } });
        // The header form of the alternate link, on the page or on the probe's answer.
        const header = page({ body: GOOD_HTML, headers: { link: '</docs/>; rel="describedby", </index.md>; rel="alternate"; type="text/markdown"' } });
        expect(await withContext('markdown_negotiation', { markdown: html }, header)).toMatchObject({ status: 'pass', evidence: { alternate: '/index.md' } });
        expect((await withContext('markdown_negotiation', { markdown: { ...html, link: '</x.md>; type="text/markdown"; rel=alternate' } })).status).toBe('pass');
        expect((await withContext('markdown_negotiation', { markdown: { ...html, link: '</x.css>; rel="preload"; as="style"' } })).status).toBe('warn');
        expect((await withContext('markdown_negotiation', { markdown: file({ status: 429 }) as MarkdownProbe })).skippedReason).toBe('blocked');
    });

    it('lets a site keep AI training crawlers out, and warns when it shuts out the ones that answer people', async () => {
        const run = (body: string, overrides: Partial<SiteFile> = {}) => withContext('ai_crawlers', { robots: file({ url: 'https://example.com/robots.txt', body, ...overrides }) });
        expect(await run('User-agent: *\nAllow: /')).toMatchObject({ status: 'pass', evidence: { blockedRetrieval: '', blockedTraining: '' } });
        expect(await run('User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: Bytespider\nDisallow: /')).toMatchObject({
            status: 'pass',
            evidence: { blockedTraining: 'GPTBot, ClaudeBot, Bytespider' },
        });
        // A Content-Signal that refuses search or AI answers keeps the site out of them too; one that refuses training only does not.
        expect(await run('User-agent: *\nContent-Signal: search=yes, ai-input=no\nAllow: /')).toMatchObject({ status: 'warn', evidence: { refusedBySignal: AI_RETRIEVAL_AGENTS.join(', ') } });
        expect((await run('User-agent: *\nContent-Signal: ai-train=no, search=yes, ai-input=yes\nAllow: /')).status).toBe('pass');
        expect(await run('User-agent: ChatGPT-User\nDisallow: /')).toMatchObject({ status: 'warn', evidence: { blockedRetrieval: 'ChatGPT-User' } });
        expect((await run('User-agent: *\nDisallow: /')).status).toBe('fail');
        // A crawler named by its own group is judged by that group, not by `*`.
        expect(
            (
                await run(
                    'User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nUser-agent: ChatGPT-User\nUser-agent: Claude-SearchBot\nUser-agent: Claude-User\nUser-agent: PerplexityBot\nUser-agent: Perplexity-User\nAllow: /',
                )
            ).status,
        ).toBe('pass');
        expect((await run('Not found', { status: 404 })).skippedReason).toBe('no_robots');
        expect((await run('', { status: 503 })).skippedReason).toBe('robots_error');
        expect((await run('', { status: 403 })).skippedReason).toBe('blocked');
    });

    it('count the words a visitor reads in the HTML, not those in scripts, and call an empty shell a failure', async () => {
        const run = (body: string) => withContext('content_in_html', {}, page({ body: `<html><head><title>T</title></head><body>${body}</body></html>` }));
        expect(await run('<p>word </p>'.repeat(60))).toMatchObject({ status: 'pass', evidence: { words: 60 } });
        expect((await run('<p>one two three four five six seven eight nine ten eleven twelve</p>')).status).toBe('warn');
        // A single-page app: a mount point and a bundle.
        expect(
            await run('<div id="root"></div><script src="/app.js"></script><script>' + 'var a = 1; '.repeat(100) + '</script><noscript>Please enable JavaScript to run this app.</noscript>'),
        ).toMatchObject({ status: 'fail', evidence: { words: 0, scripts: 1 } });
        expect((await withContext('content_in_html', {}, page({ status: 403, body: '' }))).skippedReason).toBe('blocked');
    });

    it('skip a stub that sends the visitor on at once by meta refresh, and judge one that waits', async () => {
        const stub = (content: string) => page({ body: `<html><head><meta http-equiv="refresh" content="${content}"></head><body></body></html>` });
        for (const id of ['content_in_html', 'seo_title', 'h1', 'html_lang']) {
            expect(await withContext(id, {}, stub('0;url=/cs/?session=SECRET')), id).toMatchObject({
                status: 'skipped',
                skippedReason: 'meta_refresh',
                evidence: { target: 'https://example.com/cs/?session=…' },
            });
        }
        expect((await withContext('content_in_html', {}, stub("1; URL='https://example.com/en/'"))).skippedReason).toBe('meta_refresh');
        expect((await withContext('content_in_html', {}, stub('30;url=/cs/'))).status).toBe('fail');
        // A refresh without an address only reloads the page.
        expect((await withContext('content_in_html', {}, stub('0'))).status).toBe('fail');
    });
});

describe('ttfb', () => {
    const withTtfb = (ttfbMs: number, status = 200) => runCheck(byId('ttfb'), context('https://example.com', page({ ttfbMs, status })));

    it('passes up to 800 ms, warns up to 1.8 s and fails above', async () => {
        expect(await withTtfb(800)).toMatchObject({ status: 'pass', evidence: { ttfbMs: 800 } });
        expect(await withTtfb(801)).toMatchObject({ status: 'warn' });
        expect(await withTtfb(1800)).toMatchObject({ status: 'warn' });
        expect(await withTtfb(1801)).toMatchObject({ status: 'fail' });
    });

    it('does not judge the speed of a firewall page', async () => {
        expect(await withTtfb(3000, 403)).toMatchObject({ status: 'skipped' });
    });
});

describe('compression', () => {
    const big = { contentType: 'text/html', bytes: 50_000 };
    const asset = (contentEncoding: string | null, bytes = 20_000, status = 200) => ({
        url: 'https://example.com/a.js',
        status,
        contentType: 'text/javascript',
        contentEncoding,
        cacheControl: null,
        etag: null,
        lastModified: null,
        bytes,
        transferredBytes: bytes,
    });
    const run = (overrides: Partial<FetchedPage>, assetSample?: ReturnType<typeof asset>[]) =>
        runCheck(byId('compression'), { ...context('https://example.com', page(overrides)), ...(assetSample === undefined ? {} : { assetSample }) });

    it('fails a page sent uncompressed and passes one that is compressed', async () => {
        expect(await run({ ...big })).toMatchObject({ status: 'fail', evidence: { htmlEncoding: 'none' } });
        expect(await run({ ...big, headers: { 'content-encoding': 'identity' } })).toMatchObject({ status: 'fail' });
        expect(await run({ ...big, headers: { 'content-encoding': 'br' } })).toMatchObject({ status: 'pass', evidence: { htmlEncoding: 'br' } });
    });

    it('lets a page under 1 kB be: there is nothing to gain', async () => {
        expect(await run({ contentType: 'text/html', bytes: 1024 })).toMatchObject({ status: 'pass' });
    });

    it('warns when the page is compressed but a script or stylesheet is not', async () => {
        const headers = { 'content-encoding': 'gzip' };
        expect(await run({ ...big, headers }, [asset('gzip'), asset(null)])).toMatchObject({ status: 'warn', evidence: { filesSampled: 2, filesUncompressed: 1 } });
        expect(await run({ ...big, headers }, [asset('gzip'), asset(null, 500), asset(null, 20_000, 404)])).toMatchObject({ status: 'pass', evidence: { filesSampled: 2, filesUncompressed: 0 } });
    });

    it('does not judge what is not an HTML page, or a firewall page', async () => {
        expect(await run({ ...big, contentType: 'application/pdf' })).toMatchObject({ status: 'skipped', skippedReason: 'not_html' });
        expect(await run({ ...big, status: 500 })).toMatchObject({ status: 'skipped' });
        expect(await run({ ...big, status: 403 })).toMatchObject({ status: 'skipped' });
    });
});

describe('cache_headers', () => {
    const file = (extra: { cacheControl?: string; etag?: string; lastModified?: string } = {}, status = 200) => ({
        url: 'https://example.com/a.js',
        status,
        contentType: 'text/javascript',
        contentEncoding: null,
        cacheControl: extra.cacheControl ?? null,
        etag: extra.etag ?? null,
        lastModified: extra.lastModified ?? null,
        bytes: 5000,
        transferredBytes: 5000,
    });
    const run = (...assetSample: ReturnType<typeof file>[]) => runCheck(byId('cache_headers'), { ...context('https://example.com', page()), assetSample });

    it('passes files with a lifetime or a validator, warns on no-store, max-age=0 or no caching headers at all', async () => {
        expect(await run(file({ cacheControl: 'public, max-age=31536000, immutable' }), file({ etag: '"x"' }), file({ lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' }))).toMatchObject({
            status: 'pass',
            evidence: { filesSampled: 3, filesUncached: 0 },
        });
        expect(await run(file({ cacheControl: 'no-store' }))).toMatchObject({ status: 'warn', evidence: { filesUncached: 1, example: 'https://example.com/a.js' } });
        expect(await run(file({ cacheControl: 'private, max-age=0', etag: '"x"' }))).toMatchObject({ status: 'warn' });
        expect(await run(file())).toMatchObject({ status: 'warn' });
    });

    it('has nothing to judge without an answering file', async () => {
        expect(await run()).toMatchObject({ status: 'skipped', skippedReason: 'no_sample' });
        expect(await run(file({}, 404))).toMatchObject({ status: 'skipped' });
    });
});

describe('http_version', () => {
    const run = (overrides: Partial<FetchedPage>) => runCheck(byId('http_version'), context('https://example.com', page(overrides)));

    it('passes HTTP/2 or an advertised HTTP/3, warns on HTTP/1.1', async () => {
        expect(await run({ alpn: 'h2' })).toMatchObject({ status: 'pass', evidence: { protocol: 'h2', h3Advertised: false } });
        expect(await run({ alpn: 'http/1.1', headers: { 'alt-svc': 'h3=":443"; ma=86400' } })).toMatchObject({ status: 'pass', evidence: { h3Advertised: true } });
        expect(await run({ alpn: 'http/1.1', headers: { 'alt-svc': 'h3-29=":443"' } })).toMatchObject({ status: 'pass' });
        expect(await run({ alpn: 'http/1.1' })).toMatchObject({ status: 'warn', evidence: { protocol: 'http/1.1' } });
        expect(await run({ alpn: 'http/1.1', headers: { 'alt-svc': 'clear' } })).toMatchObject({ status: 'warn' });
    });

    it('does not guess when no handshake told the protocol, and skips a firewall page', async () => {
        expect(await run({ alpn: null })).toMatchObject({ status: 'skipped', skippedReason: 'protocol_unknown' });
        expect(await run({ alpn: 'http/1.1', status: 403 })).toMatchObject({ status: 'skipped' });
    });
});

describe('page_weight', () => {
    const run = (overrides: Partial<FetchedPage>) => runCheck(byId('page_weight'), context('https://example.com', page({ contentType: 'text/html', ...overrides })));
    const tags = (count: number, tag: string) => tag.repeat(count);

    it('counts scripts, styles, images and preloaded fonts, and passes a light page', async () => {
        const body =
            '<link rel="stylesheet" href="/a.css"><link rel="preload stylesheet" href="/b.css"><link rel="preload" as="font" href="/f.woff2"><link rel="icon" href="/i.ico">' +
            '<script src="/a.js"></script><script>inline()</script><script src=""></script><img src="/1.png"><img src="/2.png"><img src="/3.png">';
        expect(await run({ body, bytes: 20_000, transferredBytes: 6000 })).toMatchObject({
            status: 'pass',
            evidence: { htmlBytes: 20_000, htmlTransferredBytes: 6000, scripts: 1, styles: 2, images: 3, fonts: 1 },
        });
    });

    it('warns over 500 kB of HTML or 100 files, fails over 1 MB, 200 files or a cut-off page', async () => {
        expect(await run({ body: '', bytes: 500_001 })).toMatchObject({ status: 'warn' });
        expect(await run({ body: tags(101, '<img src="/a.png">') })).toMatchObject({ status: 'warn' });
        expect(await run({ body: tags(100, '<img src="/a.png">') })).toMatchObject({ status: 'pass' });
        expect(await run({ body: '', bytes: 1_000_001 })).toMatchObject({ status: 'fail' });
        expect(await run({ body: tags(201, '<img src="/a.png">') })).toMatchObject({ status: 'fail' });
        expect(await run({ body: '', bytes: 1_000_000, truncated: true })).toMatchObject({ status: 'fail', evidence: { truncated: true } });
    });

    it('judges neither a page that is not HTML, an error page nor a firewall page', async () => {
        expect(await run({ contentType: 'application/pdf' })).toMatchObject({ status: 'skipped', skippedReason: 'not_html' });
        expect(await run({ status: 404 })).toMatchObject({ status: 'skipped', skippedReason: 'error_page' });
        expect(await run({ status: 403 })).toMatchObject({ status: 'skipped' });
    });
});

describe('render_blocking', () => {
    const run = (head: string, overrides: Partial<FetchedPage> = {}) =>
        runCheck(
            byId('render_blocking'),
            context('https://example.com', page({ contentType: 'text/html', body: `<html><head>${head}</head><body><script src="/body.js"></script></body></html>`, ...overrides })),
        );
    const scripts = (count: number) => '<script src="/a.js"></script>'.repeat(count);

    it('passes a head with deferred, async and module scripts, and a body script', async () => {
        expect(
            await run(
                '<script src="/a.js" defer></script><script src="/b.js" async></script><script type="module" src="/c.js"></script><script>inline()</script><link rel="stylesheet" href="/a.css">',
            ),
        ).toMatchObject({
            status: 'pass',
            evidence: { blockingScripts: 0, blockingStyles: 1 },
        });
    });

    it('warns on a blocking script or more than four stylesheets, fails on four scripts', async () => {
        expect(await run(scripts(1))).toMatchObject({ status: 'warn', evidence: { blockingScripts: 1 } });
        expect(await run(scripts(3))).toMatchObject({ status: 'warn' });
        expect(await run(scripts(4))).toMatchObject({ status: 'fail' });
        const sheets = (count: number) => '<link rel="stylesheet" href="/a.css">'.repeat(count);
        expect(await run(sheets(4))).toMatchObject({ status: 'pass' });
        expect(await run(sheets(5))).toMatchObject({ status: 'warn', evidence: { blockingStyles: 5 } });
        expect(await run(`${sheets(4)}<link rel="stylesheet" href="/p.css" media="print">`)).toMatchObject({ status: 'pass', evidence: { blockingStyles: 4 } });
    });

    it('judges neither a page that is not HTML, an error page nor a firewall page', async () => {
        expect(await run(scripts(1), { contentType: 'application/pdf' })).toMatchObject({ status: 'skipped', skippedReason: 'not_html' });
        expect(await run(scripts(1), { status: 404 })).toMatchObject({ status: 'skipped', skippedReason: 'error_page' });
        expect(await run(scripts(1), { status: 403 })).toMatchObject({ status: 'skipped' });
    });
});

describe('image_formats', () => {
    const run = (body: string, overrides: Partial<FetchedPage> = {}) => runCheck(byId('image_formats'), context('https://example.com', page({ contentType: 'text/html', body, ...overrides })));
    const img = (src: string) => `<img src="${src}">`;

    it('warns when three or more images are JPEG, PNG or GIF and fewer than half are WebP or AVIF', async () => {
        expect(await run(img('/a.jpg') + img('/b.PNG?v=2') + img('/c.gif') + img('/d.webp'))).toMatchObject({ status: 'warn', evidence: { images: 4, modern: 1, legacy: 3, modernPercent: 25 } });
        expect(await run(img('/a.jpg') + img('/b.png') + img('/c.gif') + img('/d.webp') + img('/e.avif') + img('/f.webp'))).toMatchObject({ status: 'pass', evidence: { modernPercent: 50 } });
        expect(await run(img('/a.jpg') + img('/b.png'))).toMatchObject({ status: 'pass' });
    });

    it('counts a picture that offers WebP, reads srcset when there is no src, and leaves out SVG, data and unknown addresses', async () => {
        const picture = '<picture><source type="image/webp" srcset="/a.webp"><img src="/a.jpg"></picture>';
        expect(await run(picture + img('/b.jpg') + img('/c.jpg'))).toMatchObject({ status: 'pass', evidence: { modern: 1, legacy: 2 } });
        expect(await run('<img srcset="/a.jpg 1x, /a2.jpg 2x"><img srcset="/b.webp 480w">')).toMatchObject({ evidence: { images: 2, modern: 1, legacy: 1 } });
        expect(await run(img('/a.svg') + img('data:image/png;base64,AAAA') + img('/photo') + '<img>')).toMatchObject({ status: 'skipped', skippedReason: 'no_images' });
    });

    it('judges neither a page that is not HTML, an error page nor a firewall page', async () => {
        expect(await run(img('/a.jpg'), { contentType: 'application/pdf' })).toMatchObject({ status: 'skipped', skippedReason: 'not_html' });
        expect(await run(img('/a.jpg'), { status: 404 })).toMatchObject({ status: 'skipped', skippedReason: 'error_page' });
        expect(await run(img('/a.jpg'), { status: 403 })).toMatchObject({ status: 'skipped' });
    });
});

describe('lazy_loading', () => {
    const run = (body: string, overrides: Partial<FetchedPage> = {}) => runCheck(byId('lazy_loading'), context('https://example.com', page({ contentType: 'text/html', body, ...overrides })));
    const img = (loading?: string) => `<img src="/a.jpg"${loading === undefined ? '' : ` loading="${loading}"`}>`;
    const first = img().repeat(3);

    it('leaves the first three images alone and warns when fewer than half of the rest are lazy', async () => {
        expect(await run(first + img() + img() + img())).toMatchObject({ status: 'warn', evidence: { images: 6, belowFirstScreen: 3, lazy: 0, notLazy: 3 } });
        expect(await run(first + img('lazy') + img() + img())).toMatchObject({ status: 'warn' });
        expect(await run(first + img('lazy') + img('LAZY') + img())).toMatchObject({ status: 'pass', evidence: { lazy: 2, notLazy: 1 } });
        expect(await run(first + img('lazy').repeat(3))).toMatchObject({ status: 'pass' });
    });

    it('has nothing to judge on a page with few images, and no `src` is no image', async () => {
        expect(await run(first + img() + img())).toMatchObject({ status: 'skipped', skippedReason: 'few_images' });
        expect(await run(first + '<img><img src="data:image/png;base64,AA"><img src="">'.repeat(3))).toMatchObject({ status: 'skipped', skippedReason: 'few_images' });
    });

    it('judges neither a page that is not HTML, an error page nor a firewall page', async () => {
        expect(await run(first + img().repeat(3), { contentType: 'application/pdf' })).toMatchObject({ status: 'skipped', skippedReason: 'not_html' });
        expect(await run(first + img().repeat(3), { status: 404 })).toMatchObject({ status: 'skipped', skippedReason: 'error_page' });
        expect(await run(first + img().repeat(3), { status: 403 })).toMatchObject({ status: 'skipped' });
    });
});

describe('assetUrlsOf', () => {
    it('lists the stylesheets and scripts of the page itself, resolved, without repeats, other sites or fragments', async () => {
        const body =
            '<html><head><link rel="stylesheet" href="/a.css"><link rel="preload stylesheet" href="b.css#x"><link rel="icon" href="/i.ico">' +
            '<script src="/a.css"></script><script src="https://cdn.other.com/x.js"></script><script src="//www.example.com/c.js"></script><script src=""></script></head></html>';
        expect(await assetUrlsOf(page({ finalUrl: 'https://example.com/dir/', body }), 10)).toEqual(['https://example.com/a.css', 'https://example.com/dir/b.css', 'https://www.example.com/c.js']);
    });
});
