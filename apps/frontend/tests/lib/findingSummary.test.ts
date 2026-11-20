import { CHECKS, type CheckResult } from '@sitehp.app/core/browser';
import { describe, expect, it } from 'vitest';
import { findingSummary, hasSummary } from '@lib/findingSummary';

const result = (checkId: string, status: CheckResult['status'], evidence: CheckResult['evidence']): CheckResult => ({
    checkId,
    category: 'seo',
    layer: 'light',
    status,
    severity: 'low',
    effort: 'minutes',
    evidence,
    pointsLost: 0,
});
const say = (id: string, status: CheckResult['status'], evidence: CheckResult['evidence']) => findingSummary(id, result(id, status, evidence), 'en');

describe('findingSummary', () => {
    it('says nothing for a pass, a skip, no result or a check without a sentence', () => {
        expect(say('seo_title', 'pass', { count: 1, length: 40 })).toBeNull();
        expect(say('seo_title', 'skipped', {})).toBeNull();
        expect(findingSummary('seo_title', undefined, 'en')).toBeNull();
        expect(say('future_check', 'fail', {})).toBeNull();
    });

    it('quotes the title length against the range, or says it is missing or repeated', () => {
        expect(say('seo_title', 'warn', { count: 1, length: 12 })).toBe('Your title is 12 characters; 30 to 60 fit well in search results.');
        expect(say('seo_title', 'fail', { count: 0, length: 0 })).toBe('The page has no title.');
        expect(say('seo_title', 'warn', { count: 2, length: 40 })).toBe('The page has 2 titles instead of one.');
    });

    it('describes a missing or short HSTS and a CSP with holes', () => {
        expect(say('hsts', 'fail', { present: false })).toBe('Your server does not send a Strict-Transport-Security header.');
        expect(say('hsts', 'warn', { present: true, value: 'max-age=86400' })).toBe('Your header keeps browsers on https for 1 days; at least 180 are expected.');
        expect(say('csp', 'warn', { present: true, issues: 'unsafe-inline, no-base-uri' })).toBe('A policy is set, but it allows inline scripts, does not set base-uri.');
    });

    it('describes compression and cookies without ever repeating a cookie value', () => {
        expect(say('compression', 'fail', { htmlBytes: 52_000 })).toBe('Your page is sent uncompressed (51 kB).');
        expect(say('compression', 'warn', { filesUncompressed: 1, filesSampled: 3 })).toBe('1 of the 3 script and style files checked are sent uncompressed.');
        expect(say('cookie_secure', 'fail', { cookies: 3, missing: 2, names: 'sid, theme', rejected: 1 })).toBe(
            '2 of 3 cookies lack the Secure flag: sid, theme. 1 of them use SameSite=None without Secure, so browsers reject them.',
        );
    });

    it('has a sentence for every check in the registry', () => {
        for (const check of CHECKS) expect(hasSummary(check.id), check.id).toBe(true);
    });

    // Typical evidence of a failing page, one per check: no sentence may carry a hole (`undefined`, `NaN`, a leftover placeholder) or be empty.
    const failing: Record<string, CheckResult['evidence']> = {
        https_scheme: { finalScheme: 'http' },
        http_redirect: { status: 200, finalUrl: 'http://a.test/' },
        cert_valid: { available: true, error: 'self-signed certificate' },
        cert_expiry: { daysLeft: 9, validTo: 'Oct 23 2026' },
        x_frame_options: { present: false },
        x_content_type_options: { present: true, value: 'sniff' },
        referrer_policy: { present: true, policy: 'unsafe-url' },
        permissions_policy: { present: false },
        coop: { present: false },
        info_leak: { server: 'nginx/1.18', poweredBy: 'PHP/8.1' },
        cookie_httponly: { cookies: 2, missing: 1, names: 'sid' },
        cookie_samesite: { cookies: 2, missing: 1, names: 'sid' },
        mixed_content: { active: 1, passive: 0, example: 'http://a.test/x.js' },
        http_status: { status: 500 },
        h1: { count: 2 },
        viewport: { present: true, zoomBlocked: true },
        html_lang: { lang: '' },
        canonical: { present: true, absolute: false, href: '/x' },
        noindex: { meta: true, header: false },
        open_graph: { missing: 'og:image' },
        open_graph_quality: { missing: '', imageAbsolute: false },
        twitter_card: { present: false },
        heading_order: { count: 5, skips: 1 },
        img_alt: { images: 4, missing: 2 },
        img_dimensions: { images: 4, missing: 2 },
        favicon: { present: false },
        json_ld: { blocks: 1, invalid: 0, untyped: 1 },
        hreflang: { count: 2, invalid: 0, self: false },
        robots_txt: { present: false, status: 404 },
        robots_allows_page: { allowed: false, rule: 'Disallow: /' },
        sitemap_xml: { present: false, status: 404 },
        sitemap_in_robots: { listed: 0 },
        sitemap_urls: { sampled: 5, failing: 2, redirected: 1, unindexable: 0, example: 'https://a.test/x' },
        redirect_chain: { hops: 4, temporary: false },
        soft_404: { status: 200, finalUrl: 'https://a.test/', redirected: true },
        canonical_host: { count: 2, addresses: 'a.test, www.a.test' },
        llms_txt: { present: false, status: 404 },
        markdown_negotiation: { served: false },
        ai_crawlers: { blockedRetrieval: 'OAI-SearchBot', refusedBySignal: '' },
        content_in_html: { words: 3, scripts: 4 },
        ttfb: { ttfbMs: 2100 },
        cache_headers: { filesSampled: 3, filesUncached: 2, example: 'https://a.test/a.js' },
        http_version: { protocol: 'http/1.1' },
        page_weight: { htmlBytes: 700_000, scripts: 60, styles: 10, images: 40, fonts: 2, truncated: false },
        render_blocking: { blockingScripts: 2, blockingStyles: 5 },
        image_formats: { images: 8, modern: 0, legacy: 8, modernPercent: 0 },
        lazy_loading: { images: 9, belowFirstScreen: 6, lazy: 0, notLazy: 6 },
    };

    it.each(Object.entries(failing))('writes a clean sentence for a failing %s', (id, evidence) => {
        const sentence = say(id, 'warn', evidence);
        expect(sentence, id).not.toBeNull();
        expect(sentence, id).not.toMatch(/undefined|NaN|\{|\}|null/);
    });
});
