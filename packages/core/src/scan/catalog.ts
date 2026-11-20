import type { CheckMeta } from './check.ts';

/**
 * Every check the engine runs, in registry order, without its `run`: what a browser needs to list, group and weigh the
 * checks. Kept apart from `checks/` so the runners (and parse5 behind them) never reach a client bundle.
 * `tests/catalog.test.ts` fails when this list and the registry disagree.
 */
export const CHECK_CATALOG: readonly CheckMeta[] = [
    { id: 'http_status', category: 'seo', group: 'page', layer: 'light', severity: 'critical', effort: 'hours' },
    { id: 'https_scheme', category: 'security', group: 'https', layer: 'light', severity: 'critical', effort: 'hours' },
    { id: 'http_redirect', category: 'security', group: 'https', layer: 'light', severity: 'high', effort: 'minutes' },
    { id: 'cert_valid', category: 'security', group: 'https', layer: 'light', severity: 'critical', effort: 'hours' },
    { id: 'cert_expiry', category: 'security', group: 'https', layer: 'light', severity: 'high', effort: 'minutes' },
    { id: 'hsts', category: 'security', group: 'headers', layer: 'light', severity: 'high', effort: 'minutes' },
    { id: 'csp', category: 'security', group: 'headers', layer: 'light', severity: 'medium', effort: 'hours' },
    { id: 'x_frame_options', category: 'security', group: 'headers', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'x_content_type_options', category: 'security', group: 'headers', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'referrer_policy', category: 'security', group: 'headers', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'permissions_policy', category: 'security', group: 'headers', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'coop', category: 'security', group: 'headers', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'info_leak', category: 'security', group: 'headers', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'cookie_secure', category: 'security', group: 'cookies', layer: 'light', severity: 'high', effort: 'minutes' },
    { id: 'cookie_httponly', category: 'security', group: 'cookies', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'cookie_samesite', category: 'security', group: 'cookies', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'mixed_content', category: 'security', group: 'content', layer: 'light', severity: 'high', effort: 'hours' },
    { id: 'seo_title', category: 'seo', group: 'page', layer: 'light', severity: 'high', effort: 'minutes' },
    { id: 'meta_description', category: 'seo', group: 'page', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'h1', category: 'seo', group: 'page', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'viewport', category: 'seo', group: 'page', layer: 'light', severity: 'high', effort: 'minutes' },
    { id: 'html_lang', category: 'seo', group: 'page', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'canonical', category: 'seo', group: 'indexing', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'noindex', category: 'seo', group: 'indexing', layer: 'light', severity: 'critical', effort: 'minutes' },
    { id: 'open_graph', category: 'seo', group: 'social', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'open_graph_quality', category: 'seo', group: 'social', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'twitter_card', category: 'seo', group: 'social', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'heading_order', category: 'seo', group: 'page', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'img_alt', category: 'seo', group: 'page', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'img_dimensions', category: 'seo', group: 'page', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'favicon', category: 'seo', group: 'page', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'json_ld', category: 'seo', group: 'page', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'hreflang', category: 'seo', group: 'indexing', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'robots_txt', category: 'seo', group: 'files', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'robots_allows_page', category: 'seo', group: 'indexing', layer: 'light', severity: 'critical', effort: 'minutes' },
    { id: 'sitemap_xml', category: 'seo', group: 'files', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'sitemap_in_robots', category: 'seo', group: 'files', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'sitemap_urls', category: 'seo', group: 'files', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'redirect_chain', category: 'seo', group: 'indexing', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'soft_404', category: 'seo', group: 'indexing', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'canonical_host', category: 'seo', group: 'indexing', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'llms_txt', category: 'agent', group: 'agent_content', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'markdown_negotiation', category: 'agent', group: 'agent_content', layer: 'light', severity: 'low', effort: 'hours' },
    { id: 'ai_crawlers', category: 'agent', group: 'agent_access', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'content_in_html', category: 'agent', group: 'agent_content', layer: 'light', severity: 'high', effort: 'days' },
    { id: 'link_headers', category: 'agent', group: 'agent_discovery', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'api_catalog', category: 'agent', group: 'agent_discovery', layer: 'light', severity: 'low', effort: 'hours' },
    { id: 'oauth_resource', category: 'agent', group: 'agent_discovery', layer: 'light', severity: 'low', effort: 'hours' },
    { id: 'a2a_agent_card', category: 'agent', group: 'agent_discovery', layer: 'light', severity: 'low', effort: 'hours' },
    { id: 'ttfb', category: 'speed', group: 'speed_server', layer: 'light', severity: 'medium', effort: 'hours' },
    { id: 'compression', category: 'speed', group: 'speed_server', layer: 'light', severity: 'medium', effort: 'minutes' },
    { id: 'cache_headers', category: 'speed', group: 'speed_server', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'http_version', category: 'speed', group: 'speed_server', layer: 'light', severity: 'low', effort: 'minutes' },
    { id: 'page_weight', category: 'speed', group: 'speed_page', layer: 'light', severity: 'low', effort: 'hours' },
    { id: 'render_blocking', category: 'speed', group: 'speed_page', layer: 'light', severity: 'low', effort: 'hours' },
    { id: 'image_formats', category: 'speed', group: 'speed_page', layer: 'light', severity: 'low', effort: 'hours' },
    { id: 'lazy_loading', category: 'speed', group: 'speed_page', layer: 'light', severity: 'low', effort: 'minutes' },
];

/** Checks that always run, even in a customized scan: `http_status` decides whether the scanner was turned away, and with it whether there is a score at all. */
export const ALWAYS_CHECKED: readonly string[] = ['http_status'];

/**
 * A person's choice of checks as what is stored: the ids in registry order, the always-on ones added, unknown ids dropped and reported.
 * `ids` is undefined when the choice covers every check, which is a plain full scan (so it can be reused, and carries no selection).
 */
export const normalizeSelection = (selected: readonly string[]): { ids: string[] | undefined; unknown: string[] } => {
    const known = new Set(CHECK_CATALOG.map((check) => check.id));
    const wanted = new Set([...selected, ...ALWAYS_CHECKED]);
    const ids = CHECK_CATALOG.filter((check) => wanted.has(check.id)).map((check) => check.id);
    return { ids: ids.length === CHECK_CATALOG.length ? undefined : ids, unknown: Array.from(new Set(selected.filter((id) => !known.has(id)))) };
};

/** The checks of a scan: all of them, or the stored selection in registry order. */
export const catalogFor = (selected: readonly string[] | undefined): readonly CheckMeta[] => (selected === undefined ? CHECK_CATALOG : CHECK_CATALOG.filter((check) => selected.includes(check.id)));
