import type { Category, Group, ScoreBand } from '@sitehp.app/core/browser';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { m } from '@paraglide/messages.js';

/** Titles of the report's categories and groups, by id. A test keeps these in step with the registry: a new one without its title fails the build. */
const categoryTitles: Record<Category, (locale: Locale) => string> = {
    security: (locale) => m.report_category_security({}, { locale }),
    speed: (locale) => m.report_category_speed({}, { locale }),
    seo: (locale) => m.report_category_seo({}, { locale }),
    privacy: (locale) => m.report_category_privacy({}, { locale }),
    agent: (locale) => m.report_category_agent({}, { locale }),
    email: (locale) => m.report_category_email({}, { locale }),
};

const groupTitles: Record<Group, (locale: Locale) => string> = {
    https: (locale) => m.report_group_https({}, { locale }),
    headers: (locale) => m.report_group_headers({}, { locale }),
    cookies: (locale) => m.report_group_cookies({}, { locale }),
    content: (locale) => m.report_group_content({}, { locale }),
    page: (locale) => m.report_group_page({}, { locale }),
    indexing: (locale) => m.report_group_indexing({}, { locale }),
    social: (locale) => m.report_group_social({}, { locale }),
    files: (locale) => m.report_group_files({}, { locale }),
    agent_access: (locale) => m.report_group_agent_access({}, { locale }),
    agent_content: (locale) => m.report_group_agent_content({}, { locale }),
    agent_discovery: (locale) => m.report_group_agent_discovery({}, { locale }),
    speed_server: (locale) => m.report_group_speed_server({}, { locale }),
    speed_page: (locale) => m.report_group_speed_page({}, { locale }),
};

const bandTitles: Record<ScoreBand, (locale: Locale) => string> = {
    critical: (locale) => m.method_band_critical({}, { locale }),
    poor: (locale) => m.method_band_poor({}, { locale }),
    fair: (locale) => m.method_band_fair({}, { locale }),
    good: (locale) => m.method_band_good({}, { locale }),
    excellent: (locale) => m.method_band_excellent({}, { locale }),
};

export const bandTitle = (band: ScoreBand, locale: Locale): string => bandTitles[band](locale);
export const categoryTitle = (category: Category, locale: Locale): string => categoryTitles[category](locale);
export const groupTitle = (group: Group, locale: Locale): string => groupTitles[group](locale);
