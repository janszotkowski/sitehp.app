import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

type CheckText = { title: string; explanation: string };

/**
 * The human text of every check, by `checkId`: what it is, why it matters and
 * what happens without it. The engine returns no prose, so the wording lives
 * here, in the page language. A test keeps this map in step with the registry
 * in `@sitehp.app/core`: adding a check without its text fails the build.
 */
export const checkTexts: Record<string, (locale: Locale) => CheckText> = {
    https_scheme: (locale) => ({ title: m.check_https_scheme_title({}, { locale }), explanation: m.check_https_scheme_explanation({}, { locale }) }),
    hsts: (locale) => ({ title: m.check_hsts_title({}, { locale }), explanation: m.check_hsts_explanation({}, { locale }) }),
    csp: (locale) => ({ title: m.check_csp_title({}, { locale }), explanation: m.check_csp_explanation({}, { locale }) }),
    x_frame_options: (locale) => ({ title: m.check_x_frame_options_title({}, { locale }), explanation: m.check_x_frame_options_explanation({}, { locale }) }),
    x_content_type_options: (locale) => ({ title: m.check_x_content_type_options_title({}, { locale }), explanation: m.check_x_content_type_options_explanation({}, { locale }) }),
    referrer_policy: (locale) => ({ title: m.check_referrer_policy_title({}, { locale }), explanation: m.check_referrer_policy_explanation({}, { locale }) }),
    permissions_policy: (locale) => ({ title: m.check_permissions_policy_title({}, { locale }), explanation: m.check_permissions_policy_explanation({}, { locale }) }),
    coop: (locale) => ({ title: m.check_coop_title({}, { locale }), explanation: m.check_coop_explanation({}, { locale }) }),
    info_leak: (locale) => ({ title: m.check_info_leak_title({}, { locale }), explanation: m.check_info_leak_explanation({}, { locale }) }),
    cookie_secure: (locale) => ({ title: m.check_cookie_secure_title({}, { locale }), explanation: m.check_cookie_secure_explanation({}, { locale }) }),
    cookie_httponly: (locale) => ({ title: m.check_cookie_httponly_title({}, { locale }), explanation: m.check_cookie_httponly_explanation({}, { locale }) }),
    cookie_samesite: (locale) => ({ title: m.check_cookie_samesite_title({}, { locale }), explanation: m.check_cookie_samesite_explanation({}, { locale }) }),
    mixed_content: (locale) => ({ title: m.check_mixed_content_title({}, { locale }), explanation: m.check_mixed_content_explanation({}, { locale }) }),
    cert_valid: (locale) => ({ title: m.check_cert_valid_title({}, { locale }), explanation: m.check_cert_valid_explanation({}, { locale }) }),
    cert_expiry: (locale) => ({ title: m.check_cert_expiry_title({}, { locale }), explanation: m.check_cert_expiry_explanation({}, { locale }) }),
    ttfb: (locale) => ({ title: m.check_ttfb_title({}, { locale }), explanation: m.check_ttfb_explanation({}, { locale }) }),
    compression: (locale) => ({ title: m.check_compression_title({}, { locale }), explanation: m.check_compression_explanation({}, { locale }) }),
    cache_headers: (locale) => ({ title: m.check_cache_headers_title({}, { locale }), explanation: m.check_cache_headers_explanation({}, { locale }) }),
    http_version: (locale) => ({ title: m.check_http_version_title({}, { locale }), explanation: m.check_http_version_explanation({}, { locale }) }),
    page_weight: (locale) => ({ title: m.check_page_weight_title({}, { locale }), explanation: m.check_page_weight_explanation({}, { locale }) }),
    render_blocking: (locale) => ({ title: m.check_render_blocking_title({}, { locale }), explanation: m.check_render_blocking_explanation({}, { locale }) }),
    image_formats: (locale) => ({ title: m.check_image_formats_title({}, { locale }), explanation: m.check_image_formats_explanation({}, { locale }) }),
    lazy_loading: (locale) => ({ title: m.check_lazy_loading_title({}, { locale }), explanation: m.check_lazy_loading_explanation({}, { locale }) }),
    http_redirect: (locale) => ({ title: m.check_http_redirect_title({}, { locale }), explanation: m.check_http_redirect_explanation({}, { locale }) }),
    http_status: (locale) => ({ title: m.check_http_status_title({}, { locale }), explanation: m.check_http_status_explanation({}, { locale }) }),
    seo_title: (locale) => ({ title: m.check_seo_title_title({}, { locale }), explanation: m.check_seo_title_explanation({}, { locale }) }),
    meta_description: (locale) => ({ title: m.check_meta_description_title({}, { locale }), explanation: m.check_meta_description_explanation({}, { locale }) }),
    h1: (locale) => ({ title: m.check_h1_title({}, { locale }), explanation: m.check_h1_explanation({}, { locale }) }),
    viewport: (locale) => ({ title: m.check_viewport_title({}, { locale }), explanation: m.check_viewport_explanation({}, { locale }) }),
    html_lang: (locale) => ({ title: m.check_html_lang_title({}, { locale }), explanation: m.check_html_lang_explanation({}, { locale }) }),
    canonical: (locale) => ({ title: m.check_canonical_title({}, { locale }), explanation: m.check_canonical_explanation({}, { locale }) }),
    noindex: (locale) => ({ title: m.check_noindex_title({}, { locale }), explanation: m.check_noindex_explanation({}, { locale }) }),
    open_graph: (locale) => ({ title: m.check_open_graph_title({}, { locale }), explanation: m.check_open_graph_explanation({}, { locale }) }),
    open_graph_quality: (locale) => ({ title: m.check_open_graph_quality_title({}, { locale }), explanation: m.check_open_graph_quality_explanation({}, { locale }) }),
    twitter_card: (locale) => ({ title: m.check_twitter_card_title({}, { locale }), explanation: m.check_twitter_card_explanation({}, { locale }) }),
    heading_order: (locale) => ({ title: m.check_heading_order_title({}, { locale }), explanation: m.check_heading_order_explanation({}, { locale }) }),
    img_alt: (locale) => ({ title: m.check_img_alt_title({}, { locale }), explanation: m.check_img_alt_explanation({}, { locale }) }),
    img_dimensions: (locale) => ({ title: m.check_img_dimensions_title({}, { locale }), explanation: m.check_img_dimensions_explanation({}, { locale }) }),
    favicon: (locale) => ({ title: m.check_favicon_title({}, { locale }), explanation: m.check_favicon_explanation({}, { locale }) }),
    json_ld: (locale) => ({ title: m.check_json_ld_title({}, { locale }), explanation: m.check_json_ld_explanation({}, { locale }) }),
    hreflang: (locale) => ({ title: m.check_hreflang_title({}, { locale }), explanation: m.check_hreflang_explanation({}, { locale }) }),
    robots_txt: (locale) => ({ title: m.check_robots_txt_title({}, { locale }), explanation: m.check_robots_txt_explanation({}, { locale }) }),
    robots_allows_page: (locale) => ({ title: m.check_robots_allows_page_title({}, { locale }), explanation: m.check_robots_allows_page_explanation({}, { locale }) }),
    sitemap_xml: (locale) => ({ title: m.check_sitemap_xml_title({}, { locale }), explanation: m.check_sitemap_xml_explanation({}, { locale }) }),
    sitemap_in_robots: (locale) => ({ title: m.check_sitemap_in_robots_title({}, { locale }), explanation: m.check_sitemap_in_robots_explanation({}, { locale }) }),
    sitemap_urls: (locale) => ({ title: m.check_sitemap_urls_title({}, { locale }), explanation: m.check_sitemap_urls_explanation({}, { locale }) }),
    redirect_chain: (locale) => ({ title: m.check_redirect_chain_title({}, { locale }), explanation: m.check_redirect_chain_explanation({}, { locale }) }),
    soft_404: (locale) => ({ title: m.check_soft_404_title({}, { locale }), explanation: m.check_soft_404_explanation({}, { locale }) }),
    llms_txt: (locale) => ({ title: m.check_llms_txt_title({}, { locale }), explanation: m.check_llms_txt_explanation({}, { locale }) }),
    link_headers: (locale) => ({ title: m.check_link_headers_title({}, { locale }), explanation: m.check_link_headers_explanation({}, { locale }) }),
    api_catalog: (locale) => ({ title: m.check_api_catalog_title({}, { locale }), explanation: m.check_api_catalog_explanation({}, { locale }) }),
    oauth_resource: (locale) => ({ title: m.check_oauth_resource_title({}, { locale }), explanation: m.check_oauth_resource_explanation({}, { locale }) }),
    a2a_agent_card: (locale) => ({ title: m.check_a2a_agent_card_title({}, { locale }), explanation: m.check_a2a_agent_card_explanation({}, { locale }) }),
    markdown_negotiation: (locale) => ({ title: m.check_markdown_negotiation_title({}, { locale }), explanation: m.check_markdown_negotiation_explanation({}, { locale }) }),
    ai_crawlers: (locale) => ({ title: m.check_ai_crawlers_title({}, { locale }), explanation: m.check_ai_crawlers_explanation({}, { locale }) }),
    content_in_html: (locale) => ({ title: m.check_content_in_html_title({}, { locale }), explanation: m.check_content_in_html_explanation({}, { locale }) }),
    canonical_host: (locale) => ({ title: m.check_canonical_host_title({}, { locale }), explanation: m.check_canonical_host_explanation({}, { locale }) }),
};

export const checkText = (checkId: string, locale: Locale): CheckText => checkTexts[checkId]?.(locale) ?? { title: checkId, explanation: '' };
