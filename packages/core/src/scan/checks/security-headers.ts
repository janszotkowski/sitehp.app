import type { CheckDefinition, CheckStatus, Evidence, Severity } from '../check.ts';
import { blockedPage } from '../gate.ts';
import { attribute, elementsOf, type HtmlElement } from '../html.ts';
import { HSTS_MIN_SECONDS } from '../limits.ts';
import type { FetchedPage } from '../page.ts';
import { hideQueryValues } from '../url.ts';

type Verdict = Exclude<CheckStatus, 'skipped'>;

/** A judge says how good a present header is, and may add what it found to the evidence. */
type Judge = (value: string, page: FetchedPage) => Verdict | { status: Verdict; evidence: Evidence };

/** One response-header check: missing fails (or warns, for headers that are hard to deploy or have a safe default), otherwise `judge` decides. Reads the fetched page only. */
const headerCheck = (id: string, header: string, severity: Severity, judge: Judge = () => 'pass', missing: 'fail' | 'warn' = 'fail'): CheckDefinition => ({
    id,
    category: 'security',
    group: 'headers',
    layer: 'light',
    severity,
    effort: 'minutes',
    run: ({ page }) => {
        if (page === undefined) throw new Error('this check needs the fetched page');
        const gate = blockedPage(page);
        if (gate !== null) return gate;
        const value = page.headers[header];
        if (value === undefined) return { status: missing, evidence: { present: false } };
        const judged = judge(value, page);
        const evidence = { present: true, value: value.slice(0, 200) };
        return typeof judged === 'string' ? { status: judged, evidence } : { status: judged.status, evidence: { ...evidence, ...judged.evidence } };
    },
});

// RFC 6797 allows the value quoted: `max-age="31536000"`.
const maxAge = (value: string): number => Number(/max-age\s*=\s*"?(\d+)/i.exec(value)?.[1] ?? 0);

// A header sent twice (by the server and by the app, common on WordPress or PHP) arrives joined with `, `: `SAMEORIGIN, SAMEORIGIN`.
const distinctValues = (value: string): string[] =>
    Array.from(
        new Set(
            value
                .split(',')
                .map((part) => part.trim().toLowerCase())
                .filter((part) => part !== ''),
        ),
    );

/** A CSP as directive name to its sources, lower-case. The first of a repeated directive wins, as in a browser. */
const directivesOf = (policy: string): Map<string, string[]> => {
    const directives = new Map<string, string[]>();
    for (const part of policy.split(';')) {
        const [name, ...sources] = part.trim().toLowerCase().split(/\s+/);
        if (name !== undefined && name !== '' && !directives.has(name)) directives.set(name, sources);
    }
    return directives;
};

type Policy = Map<string, string[]>;

// Several CSP headers arrive joined with `, `; a comma cannot occur inside a policy, so each part is a policy of its own, all enforced.
const policiesOf = (value: string): Policy[] =>
    value
        .split(',')
        .map(directivesOf)
        .filter((policy) => policy.size > 0);

// A `<meta http-equiv>` policy counts only in `<head>`, and there a browser ignores `frame-ancestors`, so it is read for scripts and upgrades only.
const metaCsps = (elements: readonly HtmlElement[]): string[] =>
    elements
        .filter((element) => element.tagName === 'meta' && element.parentNode?.nodeName === 'head' && attribute(element, 'http-equiv')?.toLowerCase() === 'content-security-policy')
        .map((element) => attribute(element, 'content') ?? '');

/** The policies of the CSP header, and of the page's `<meta>` when `elements` are given. */
export const cspPolicies = (page: FetchedPage, elements: readonly HtmlElement[] | null = null): Policy[] => [
    ...policiesOf(page.headers['content-security-policy'] ?? ''),
    ...(elements === null ? [] : metaCsps(elements).flatMap(policiesOf)),
];

// A nonce, a hash or 'strict-dynamic' makes a CSP2+ browser ignore 'unsafe-inline' (kept only as a fallback for old ones).
const INLINE_GUARD = /^'(?:nonce-|sha(?:256|384|512)-|strict-dynamic')/;
// A source that allows a script from anywhere: any host, any https or http host, or an inline data: URL.
const WIDE_SOURCES = new Set(['*', 'https:', 'http:', 'data:']);

/**
 * The CSP's script rules hold: no `'unsafe-eval'`, no `'unsafe-inline'` unless a nonce or hash overrides it, no source that allows
 * any host, and `object-src` and `base-uri` closed (plugins and a `<base>` tag are classic ways around a script policy).
 * `'strict-dynamic'` makes the browser ignore host sources, so a wide source does not count then.
 */
const issuesOf = (directives: Policy): string[] => {
    const scripts = directives.get('script-src') ?? directives.get('default-src');
    const issues: string[] = [];
    if (scripts !== undefined) {
        const guarded = scripts.some((source) => INLINE_GUARD.test(source));
        if (scripts.includes("'unsafe-eval'")) issues.push('unsafe-eval');
        if (scripts.includes("'unsafe-inline'") && !guarded) issues.push('unsafe-inline');
        if (!scripts.includes("'strict-dynamic'") && scripts.some((source) => WIDE_SOURCES.has(source))) issues.push('wide-source');
    } else issues.push('no-script-src');
    // `object-src` falls back to `default-src`; `base-uri` falls back to nothing.
    if (!directives.has('object-src') && !directives.has('default-src')) issues.push('no-object-src');
    if (!directives.has('base-uri')) issues.push('no-base-uri');
    return issues;
};

const SCRIPT_HOLES = ['unsafe-eval', 'unsafe-inline', 'wide-source'];

// A policy without script rules lets every script through, so it closes none of the script holes another policy leaves open.
const holesOf = (policy: Policy): string[] => {
    const issues = issuesOf(policy);
    return issues.includes('no-script-src') ? [...issues, ...SCRIPT_HOLES] : issues;
};

// A browser enforces every policy, so a hole is open only when no policy closes it.
const judgeCsp = (policies: readonly Policy[]): { status: Verdict; evidence: Evidence } => {
    const open = policies.map(holesOf).reduce((left, next) => left.filter((issue) => next.includes(issue)), holesOf(policies[0] ?? new Map()));
    const issues = open.includes('no-script-src') ? open.filter((issue) => !SCRIPT_HOLES.includes(issue)) : open;
    return { status: issues.length === 0 ? 'pass' : 'warn', evidence: { issues: issues.join(', ') } };
};

// Browsers use the last policy token they understand, so `no-referrer-when-downgrade, strict-origin-when-cross-origin` is the second.
const REFERRER_POLICIES = new Set(['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url']);

const judgeReferrer: Judge = (value) => {
    const policy = value
        .split(',')
        .map((token) => token.trim().toLowerCase())
        .filter((token) => REFERRER_POLICIES.has(token))
        .at(-1);
    if (policy === undefined) return { status: 'warn', evidence: { policy: null } };
    return { status: policy === 'unsafe-url' || policy === 'no-referrer-when-downgrade' ? 'warn' : 'pass', evidence: { policy } };
};

export const securityHeaders: readonly CheckDefinition[] = [
    // HSTS means nothing on a page served over http (browsers ignore it there); `https_scheme` reports that page.
    {
        ...headerCheck('hsts', 'strict-transport-security', 'high'),
        run: ({ page }) => {
            if (page === undefined) throw new Error('this check needs the fetched page');
            const gate = blockedPage(page);
            if (gate !== null) return gate;
            if (!page.finalUrl.startsWith('https://')) return { status: 'skipped', evidence: { finalUrl: hideQueryValues(page.finalUrl).slice(0, 200) }, skippedReason: 'not_applicable' };
            const value = page.headers['strict-transport-security'];
            if (value === undefined) return { status: 'fail', evidence: { present: false } };
            const evidence = { present: true, value: value.slice(0, 200), includeSubDomains: /includesubdomains/i.test(value), preload: /preload/i.test(value) };
            return { status: maxAge(value) >= HSTS_MIN_SECONDS ? 'pass' : 'warn', evidence };
        },
    },
    // A policy in a `<meta>` tag guards scripts as well as the header does, so it is judged when the header is missing.
    {
        ...headerCheck('csp', 'content-security-policy', 'medium'),
        // A policy that breaks nothing takes a trial in report-only mode first, so it is hours, not minutes.
        effort: 'hours',
        run: async ({ page }) => {
            if (page === undefined) throw new Error('this check needs the fetched page');
            const gate = blockedPage(page);
            if (gate !== null) return gate;
            const elements = /html/i.test(page.contentType ?? '') ? await elementsOf(page) : null;
            const header = page.headers['content-security-policy'];
            const value = header ?? (elements === null ? undefined : metaCsps(elements)[0]);
            if (value === undefined) return { status: 'fail', evidence: { present: false } };
            const judged = judgeCsp(cspPolicies(page, elements));
            return { status: judged.status, evidence: { present: true, value: value.slice(0, 200), ...(header === undefined ? { source: 'meta' } : {}), ...judged.evidence } };
        },
    },
    // `frame-ancestors` in the CSP replaces X-Frame-Options (a browser ignores the header when both are there), so either satisfies the check.
    {
        ...headerCheck('x_frame_options', 'x-frame-options', 'medium'),
        run: ({ page }) => {
            if (page === undefined) throw new Error('this check needs the fetched page');
            const gate = blockedPage(page);
            if (gate !== null) return gate;
            const ancestors = cspPolicies(page)
                .map((policy) => policy.get('frame-ancestors'))
                .filter((sources) => sources !== undefined);
            const header = page.headers['x-frame-options'];
            if (ancestors.length > 0) {
                // `frame-ancestors *` (or any https host) lets every site frame the page: the directive is there but protects nothing.
                // With several policies each is enforced, so one closed list is enough.
                const open = ancestors.every((sources) => sources.some((source) => source === '*' || source === 'https:' || source === 'http:'));
                return { status: open ? 'fail' : 'pass', evidence: { present: true, source: 'csp', open } };
            }
            if (header === undefined) return { status: 'fail', evidence: { present: false } };
            // Only DENY and SAMEORIGIN are understood; `ALLOW-FROM` is ignored by every current browser.
            // Two different values make browsers ignore the header; the same one repeated is fine.
            const values = distinctValues(header);
            const known = values.length === 1 && (values[0] === 'deny' || values[0] === 'sameorigin');
            return { status: known ? 'pass' : 'warn', evidence: { present: true, source: 'header', value: header.slice(0, 100) } };
        },
    },
    headerCheck('x_content_type_options', 'x-content-type-options', 'low', (value) => (distinctValues(value)[0] === 'nosniff' ? 'pass' : 'warn')),
    // Missing only warns: browsers default to `strict-origin-when-cross-origin`, which leaks no path to other sites.
    headerCheck('referrer_policy', 'referrer-policy', 'low', judgeReferrer, 'warn'),
    headerCheck('permissions_policy', 'permissions-policy', 'low', () => 'pass', 'warn'),
    headerCheck('coop', 'cross-origin-opener-policy', 'low', () => 'pass', 'warn'),
    {
        id: 'info_leak',
        category: 'security',
        group: 'headers',
        layer: 'light',
        severity: 'low',
        effort: 'minutes',
        // Announcing the software and its version helps an attacker pick a known exploit. A bare `Server: nginx` is fine.
        run: ({ page }) => {
            if (page === undefined) throw new Error('this check needs the fetched page');
            const gate = blockedPage(page);
            if (gate !== null) return gate;
            const server = page.headers['server'] ?? '';
            const poweredBy = page.headers['x-powered-by'];
            // A version is `product/1.2` or a dotted `1.18.0`; any other digit (a pod name like `mw-web.eqiad.main-67c8cb7f6b`) is not,
            // nor is a node id in parentheses (`ECS (dcb/7F84)`).
            const products = server.slice(0, 500).replace(/\([^()]*\)/g, '');
            const leaks = poweredBy !== undefined || /\/\s*v?\d/i.test(products) || /\b\d+\.\d+/.test(server);
            return { status: leaks ? 'warn' : 'pass', evidence: { server: server.slice(0, 100), poweredBy: poweredBy?.slice(0, 100) ?? null } };
        },
    },
];
