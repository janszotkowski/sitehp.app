import { DESCRIPTION_LENGTH, HSTS_MIN_SECONDS, TITLE_LENGTH, TTFB_MS, type CheckResult, type Evidence } from '@sitehp.app/core/browser';
import { evidenceValue } from '@lib/evidenceFormat';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

type Summarize = (evidence: Evidence, status: 'fail' | 'warn', locale: Locale) => string | null;

const num = (evidence: Evidence, name: string): number => {
    const value = evidence[name];
    return typeof value === 'number' ? value : 0;
};

const text = (evidence: Evidence, name: string): string => {
    const value = evidence[name];
    return typeof value === 'string' ? value : '';
};

const CSP_ISSUES: Record<string, (locale: Locale) => string> = {
    'unsafe-eval': (locale) => m.finding_csp_unsafe_eval({}, { locale }),
    'unsafe-inline': (locale) => m.finding_csp_unsafe_inline({}, { locale }),
    'wide-source': (locale) => m.finding_csp_wide_source({}, { locale }),
    'no-script-src': (locale) => m.finding_csp_no_script_src({}, { locale }),
    'no-object-src': (locale) => m.finding_csp_no_object_src({}, { locale }),
    'no-base-uri': (locale) => m.finding_csp_no_base_uri({}, { locale }),
};

/** A sentence about this page for a failing or warning check, from the evidence alone. Only the checks that have one are here; the rest show none. */
const summaries: Record<string, Summarize> = {
    hsts: (evidence, _status, locale) => {
        if (evidence.present === false) return m.finding_hsts_missing({}, { locale });
        const seconds = Number(/max-age\s*=\s*"?(\d+)/i.exec(text(evidence, 'value'))?.[1] ?? 0);
        return m.finding_hsts_short({ days: Math.round(seconds / 86_400), min: Math.round(HSTS_MIN_SECONDS / 86_400) }, { locale });
    },
    csp: (evidence, _status, locale) => {
        if (evidence.present === false) return m.finding_csp_missing({}, { locale });
        const issues = text(evidence, 'issues')
            .split(', ')
            .flatMap((issue) => CSP_ISSUES[issue]?.(locale) ?? []);
        return issues.length > 0 ? m.finding_csp_issues({ issues: issues.join(', ') }, { locale }) : null;
    },
    seo_title: (evidence, _status, locale) => {
        if (num(evidence, 'length') === 0) return m.finding_seo_title_missing({}, { locale });
        if (num(evidence, 'count') > 1) return m.finding_seo_title_many({ count: num(evidence, 'count') }, { locale });
        return m.finding_seo_title_length({ length: num(evidence, 'length'), ...TITLE_LENGTH }, { locale });
    },
    meta_description: (evidence, _status, locale) =>
        num(evidence, 'length') === 0 ? m.finding_meta_description_missing({}, { locale }) : m.finding_meta_description_length({ length: num(evidence, 'length'), ...DESCRIPTION_LENGTH }, { locale }),
    compression: (evidence, status, locale) =>
        status === 'fail'
            ? m.finding_compression_html({ size: evidenceValue('htmlBytes', String(num(evidence, 'htmlBytes')), locale).text }, { locale })
            : m.finding_compression_files({ uncompressed: num(evidence, 'filesUncompressed'), sampled: num(evidence, 'filesSampled') }, { locale }),
    cookie_secure: (evidence, _status, locale) => {
        const found = m.finding_cookie_secure({ missing: num(evidence, 'missing'), cookies: num(evidence, 'cookies'), names: text(evidence, 'names') }, { locale });
        const rejected = num(evidence, 'rejected');
        return rejected > 0 ? `${found} ${m.finding_cookie_secure_rejected({ rejected }, { locale })}` : found;
    },
    cookie_httponly: (evidence, _status, locale) => m.finding_cookie_httponly({ missing: num(evidence, 'missing'), cookies: num(evidence, 'cookies'), names: text(evidence, 'names') }, { locale }),
    cookie_samesite: (evidence, _status, locale) => m.finding_cookie_samesite({ missing: num(evidence, 'missing'), cookies: num(evidence, 'cookies'), names: text(evidence, 'names') }, { locale }),
    https_scheme: (evidence, _status, locale) => m.finding_https_scheme({ scheme: text(evidence, 'finalScheme') }, { locale }),
    http_redirect: (evidence, _status, locale) => m.finding_http_redirect({ status: num(evidence, 'status'), finalUrl: text(evidence, 'finalUrl') }, { locale }),
    cert_valid: (evidence, _status, locale) => {
        if (evidence.available === false) return m.finding_cert_valid_none({}, { locale });
        const error = text(evidence, 'error');
        return error === '' ? m.finding_cert_valid_untrusted({}, { locale }) : m.finding_cert_valid_error({ error }, { locale });
    },
    cert_expiry: (evidence, _status, locale) =>
        num(evidence, 'daysLeft') < 0
            ? m.finding_cert_expiry_expired({ date: text(evidence, 'validTo') }, { locale })
            : m.finding_cert_expiry_soon({ days: num(evidence, 'daysLeft'), date: text(evidence, 'validTo') }, { locale }),
    x_frame_options: (evidence, _status, locale) => {
        if (evidence.present === false) return m.finding_xfo_missing({}, { locale });
        return evidence.source === 'csp' ? m.finding_xfo_open({}, { locale }) : m.finding_xfo_value({ value: text(evidence, 'value') }, { locale });
    },
    x_content_type_options: (evidence, _status, locale) => (evidence.present === false ? m.finding_xcto_missing({}, { locale }) : m.finding_xcto_value({ value: text(evidence, 'value') }, { locale })),
    referrer_policy: (evidence, _status, locale) => {
        if (evidence.present === false) return m.finding_referrer_missing({}, { locale });
        const policy = text(evidence, 'policy');
        return policy === '' ? m.finding_referrer_unknown({}, { locale }) : m.finding_referrer_weak({ policy }, { locale });
    },
    permissions_policy: (_evidence, _status, locale) => m.finding_permissions_missing({}, { locale }),
    coop: (_evidence, _status, locale) => m.finding_coop_missing({}, { locale }),
    info_leak: (evidence, _status, locale) => m.finding_info_leak({ software: [text(evidence, 'server'), text(evidence, 'poweredBy')].filter((part) => part !== '').join(', ') }, { locale }),
    mixed_content: (evidence, _status, locale) =>
        num(evidence, 'active') > 0
            ? m.finding_mixed_active({ active: num(evidence, 'active'), example: text(evidence, 'example') }, { locale })
            : m.finding_mixed_passive({ passive: num(evidence, 'passive'), example: text(evidence, 'example') }, { locale }),
    http_status: (evidence, _status, locale) => m.finding_http_status({ status: num(evidence, 'status') }, { locale }),
    h1: (evidence, _status, locale) => (num(evidence, 'count') === 0 ? m.finding_h1_missing({}, { locale }) : m.finding_h1_many({ count: num(evidence, 'count') }, { locale })),
    viewport: (evidence, _status, locale) => {
        if (evidence.present === false) return m.finding_viewport_missing({}, { locale });
        return evidence.zoomBlocked === true ? m.finding_viewport_zoom({}, { locale }) : m.finding_viewport_width({}, { locale });
    },
    html_lang: (_evidence, _status, locale) => m.finding_html_lang({}, { locale }),
    canonical: (evidence, _status, locale) => {
        if (evidence.present === false) return m.finding_canonical_missing({}, { locale });
        if (evidence.conflicting === true) return m.finding_canonical_conflict({ count: num(evidence, 'count') }, { locale });
        const href = text(evidence, 'href');
        return evidence.absolute === false ? m.finding_canonical_relative({ href }, { locale }) : m.finding_canonical_other({ href }, { locale });
    },
    noindex: (evidence, _status, locale) => {
        if (evidence.meta === true && evidence.header === true) return m.finding_noindex_both({}, { locale });
        return evidence.meta === true ? m.finding_noindex_meta({}, { locale }) : m.finding_noindex_header({}, { locale });
    },
    open_graph: (evidence, _status, locale) => m.finding_open_graph({ missing: text(evidence, 'missing') }, { locale }),
    open_graph_quality: (evidence, _status, locale) =>
        text(evidence, 'missing') === '' ? m.finding_open_graph_quality_image({}, { locale }) : m.finding_open_graph_quality_missing({ missing: text(evidence, 'missing') }, { locale }),
    twitter_card: (_evidence, _status, locale) => m.finding_twitter_card({}, { locale }),
    heading_order: (evidence, _status, locale) => m.finding_heading_order({ skips: num(evidence, 'skips') }, { locale }),
    img_alt: (evidence, _status, locale) => m.finding_img_alt({ missing: num(evidence, 'missing'), images: num(evidence, 'images') }, { locale }),
    img_dimensions: (evidence, _status, locale) => m.finding_img_dimensions({ missing: num(evidence, 'missing'), images: num(evidence, 'images') }, { locale }),
    favicon: (_evidence, _status, locale) => m.finding_favicon({}, { locale }),
    json_ld: (evidence, _status, locale) => {
        if (num(evidence, 'invalid') > 0) return m.finding_json_ld_invalid({ invalid: num(evidence, 'invalid') }, { locale });
        if (num(evidence, 'blocks') === 0) return m.finding_json_ld_none({}, { locale });
        return m.finding_json_ld_untyped({ untyped: num(evidence, 'untyped') }, { locale });
    },
    hreflang: (evidence, _status, locale) =>
        num(evidence, 'invalid') > 0 ? m.finding_hreflang_invalid({ invalid: num(evidence, 'invalid'), count: num(evidence, 'count') }, { locale }) : m.finding_hreflang_self({}, { locale }),
    robots_txt: (evidence, _status, locale) =>
        num(evidence, 'status') >= 500 ? m.finding_robots_error({ status: num(evidence, 'status') }, { locale }) : m.finding_robots_missing({ status: num(evidence, 'status') }, { locale }),
    robots_allows_page: (evidence, _status, locale) => m.finding_robots_blocks({ rule: text(evidence, 'rule') }, { locale }),
    sitemap_xml: (evidence, _status, locale) => {
        if (evidence.present === false) return m.finding_sitemap_missing({ status: num(evidence, 'status') }, { locale });
        if (evidence.valid === false) return m.finding_sitemap_invalid({}, { locale });
        if (num(evidence, 'addresses') === 0) return m.finding_sitemap_empty({}, { locale });
        return m.finding_sitemap_problems({ foreign: num(evidence, 'foreign'), insecure: num(evidence, 'insecure') }, { locale });
    },
    sitemap_in_robots: (_evidence, _status, locale) => m.finding_sitemap_in_robots({}, { locale }),
    sitemap_urls: (evidence, _status, locale) =>
        m.finding_sitemap_urls(
            {
                sampled: num(evidence, 'sampled'),
                failing: num(evidence, 'failing'),
                redirected: num(evidence, 'redirected'),
                unindexable: num(evidence, 'unindexable'),
                example: text(evidence, 'example'),
            },
            { locale },
        ),
    redirect_chain: (evidence, _status, locale) => (num(evidence, 'hops') >= 3 ? m.finding_redirect_chain({ hops: num(evidence, 'hops') }, { locale }) : m.finding_redirect_temporary({}, { locale })),
    soft_404: (evidence, _status, locale) => {
        if (evidence.redirected === true) return m.finding_soft_404_redirect({ finalUrl: text(evidence, 'finalUrl') }, { locale });
        return num(evidence, 'status') >= 500 ? m.finding_soft_404_error({ status: num(evidence, 'status') }, { locale }) : m.finding_soft_404_ok({ status: num(evidence, 'status') }, { locale });
    },
    canonical_host: (evidence, _status, locale) => m.finding_canonical_host({ count: num(evidence, 'count'), addresses: text(evidence, 'addresses') }, { locale }),
    llms_txt: (evidence, _status, locale) => {
        if (evidence.present === false) return m.finding_llms_missing({ status: num(evidence, 'status') }, { locale });
        return evidence.hasTitle === false ? m.finding_llms_title({}, { locale }) : m.finding_llms_relative({ relative: num(evidence, 'relative') }, { locale });
    },
    markdown_negotiation: (evidence, _status, locale) => (evidence.served === true ? m.finding_markdown_vary({}, { locale }) : m.finding_markdown_none({}, { locale })),
    ai_crawlers: (evidence, _status, locale) =>
        text(evidence, 'blockedRetrieval') !== ''
            ? m.finding_ai_blocked({ names: text(evidence, 'blockedRetrieval') }, { locale })
            : m.finding_ai_refused({ names: text(evidence, 'refusedBySignal') }, { locale }),
    content_in_html: (evidence, _status, locale) => m.finding_content_in_html({ words: num(evidence, 'words') }, { locale }),
    ttfb: (evidence, _status, locale) => m.finding_ttfb({ ttfbMs: num(evidence, 'ttfbMs'), warn: TTFB_MS.warn }, { locale }),
    cache_headers: (evidence, _status, locale) =>
        m.finding_cache_headers({ uncached: num(evidence, 'filesUncached'), sampled: num(evidence, 'filesSampled'), example: text(evidence, 'example') }, { locale }),
    http_version: (evidence, _status, locale) => m.finding_http_version({ protocol: text(evidence, 'protocol') }, { locale }),
    page_weight: (evidence, _status, locale) => {
        if (evidence.truncated === true) return m.finding_page_weight_cut({}, { locale });
        const resources = num(evidence, 'scripts') + num(evidence, 'styles') + num(evidence, 'images') + num(evidence, 'fonts');
        return m.finding_page_weight({ size: evidenceValue('htmlBytes', String(num(evidence, 'htmlBytes')), locale).text, resources }, { locale });
    },
    render_blocking: (evidence, _status, locale) => m.finding_render_blocking({ scripts: num(evidence, 'blockingScripts'), styles: num(evidence, 'blockingStyles') }, { locale }),
    image_formats: (evidence, _status, locale) => m.finding_image_formats({ legacy: num(evidence, 'legacy'), images: num(evidence, 'images'), percent: num(evidence, 'modernPercent') }, { locale }),
    // A bonus signal: it passes or is not offered, so there is nothing wrong to describe.
    link_headers: () => null,
    api_catalog: (evidence, _status, locale) => (evidence.valid === true ? m.finding_api_catalog_empty({}, { locale }) : m.finding_api_catalog_invalid({}, { locale })),
    oauth_resource: (_evidence, _status, locale) => m.finding_oauth_resource_invalid({}, { locale }),
    a2a_agent_card: (_evidence, _status, locale) => m.finding_a2a_invalid({}, { locale }),
    lazy_loading: (evidence, _status, locale) => m.finding_lazy_loading({ notLazy: num(evidence, 'notLazy'), below: num(evidence, 'belowFirstScreen') }, { locale }),
};

export const hasSummary = (checkId: string): boolean => checkId in summaries;

export const findingSummary = (checkId: string, result: CheckResult | undefined, locale: Locale): string | null => {
    if (result === undefined || (result.status !== 'fail' && result.status !== 'warn')) return null;
    return summaries[checkId]?.(result.evidence, result.status, locale) ?? null;
};
