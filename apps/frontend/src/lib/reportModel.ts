import { CHECKS, fixGain, type Category, type CheckMeta, type CheckResult } from '@sitehp.app/core/browser';
import { checkText } from '@lib/checkMessages';
import { evidenceLabel, evidenceValue } from '@lib/evidenceFormat';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { categoryTitle, groupTitle } from '@lib/reportTitles';
import { statusLabel } from '@lib/statusLabel';
import { m } from '@paraglide/messages.js';

/** What a row shows: the check's status, `running` while it has not reported yet, `skipped` if the scan ended before it could. */
export type RowStatus = CheckResult['status'] | 'running';

export { statusLabel };

/** One check as the report lists it: the registry's definition, its result (once there is one) and what fixing it is worth. */
export type ReportRow = {
    id: string;
    definition: CheckMeta;
    result: CheckResult | undefined;
    status: RowStatus;
    /** HP gained by fixing it, one decimal; 0 when nothing is lost. */
    gain: number;
};

/** Worst first, so a sorted list leads with what needs doing. */
export const STATUS_RANK: Record<RowStatus, number> = { fail: 0, warn: 1, running: 2, skipped: 3, pass: 4 };

export const isAttention = (row: ReportRow): boolean => row.status === 'fail' || row.status === 'warn';

/** Every check of the registry, in registry order, with its result when it has one. A new check shows up here on its own. */
export const reportRows = (results: readonly CheckResult[], finished: boolean, definitions: readonly CheckMeta[] = CHECKS): ReportRow[] =>
    definitions.map((definition) => {
        const result = results.find((candidate) => candidate.checkId === definition.id);
        return { id: definition.id, definition, result, status: result?.status ?? (finished ? 'skipped' : 'running'), gain: fixGain(results, definition.id) };
    });

export const REPORT_FILTERS = ['review', 'passed', 'all'] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

export const filterCounts = (rows: readonly ReportRow[]): Record<ReportFilter, number> => ({
    review: rows.filter(isAttention).length,
    all: rows.length,
    passed: rows.filter((row) => row.status === 'pass').length,
});

export const rowsForFilter = (rows: readonly ReportRow[], filter: ReportFilter): ReportRow[] => {
    if (filter === 'review') return rows.filter(isAttention);
    if (filter === 'passed') return rows.filter((row) => row.status === 'pass');
    return [...rows];
};

/** The rows of one category; none chosen means all of them. */
export const rowsInCategory = (rows: readonly ReportRow[], category: Category | undefined): ReportRow[] =>
    category === undefined ? [...rows] : rows.filter((row) => row.definition.category === category);

/** What to fix first: the checks that need attention, the biggest HP gain first (a fail before a warn when they tie), at most `limit`. A gain of nothing is not worth leading with. */
export const topFixes = (rows: readonly ReportRow[], limit: number): ReportRow[] =>
    rows
        .filter((row) => isAttention(row) && row.gain > 0)
        .sort((a, b) => b.gain - a.gain || STATUS_RANK[a.status] - STATUS_RANK[b.status])
        .slice(0, limit);

/** The selected id while its row is still listed; a filter that hides it ends the selection rather than leaving it dangling. */
export const selectionIn = (shownIds: readonly string[], selectedId: string | undefined): string | undefined => (selectedId !== undefined && shownIds.includes(selectedId) ? selectedId : undefined);

/** The measured values behind a result as `[name, value]` pairs, in the order the check wrote them. */
export const evidenceEntries = (result: CheckResult | undefined): Array<[string, string]> =>
    Object.entries(result?.evidence ?? {}).map(([name, value]) => [name, value === null || value === '' ? '—' : String(value)]);

export const severityLabel = (severity: CheckMeta['severity'], locale: Locale): string => {
    if (severity === 'critical') return m.severity_critical({}, { locale });
    if (severity === 'high') return m.severity_high({}, { locale });
    if (severity === 'medium') return m.severity_medium({}, { locale });
    return m.severity_low({}, { locale });
};

export const effortLabel = (effort: CheckMeta['effort'], locale: Locale): string => {
    if (effort === 'minutes') return m.effort_minutes({}, { locale });
    if (effort === 'hours') return m.effort_hours({}, { locale });
    return m.effort_days({}, { locale });
};

/**
 * Full-text match for the technical view: every word of the query must appear somewhere in the row, in any order
 * and any case: its title, explanation, id, area, category, status, severity or measured values.
 */
export const matchesQuery = (row: ReportRow, query: string, locale: Locale): boolean => {
    const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word !== '');
    if (words.length === 0) return true;
    const text = checkText(row.id, locale);
    const haystack = [
        text.title,
        text.explanation,
        row.id,
        groupTitle(row.definition.group, locale),
        categoryTitle(row.definition.category, locale),
        statusLabel(row.status, locale),
        severityLabel(row.definition.severity, locale),
        ...evidenceEntries(row.result).flat(),
    ]
        .join(' ')
        .toLowerCase();
    return words.every((word) => haystack.includes(word));
};

/** The report as plain data for a developer: one object per check, no prose. */
export const reportAsJson = (domain: string, score: number | null, rows: readonly ReportRow[]): string =>
    JSON.stringify(
        {
            domain,
            score,
            checks: rows.map((row) => ({
                id: row.id,
                category: row.definition.category,
                group: row.definition.group,
                status: row.status,
                severity: row.definition.severity,
                effort: row.definition.effort,
                gain: row.gain,
                evidence: row.result?.evidence ?? {},
            })),
        },
        null,
        2,
    );

/** The status the page answered with when the site turned the scanner away (there is no score then), else null. */
export const blockedStatus = (results: readonly CheckResult[]): number | null => {
    const status = results.find((result) => result.checkId === 'http_status' && result.skippedReason === 'blocked')?.evidence['status'];
    return typeof status === 'number' ? status : null;
};

const SKIPPED_REASONS: Record<string, (locale: Locale) => string> = {
    blocked: (locale) => m.report_skipped_blocked({}, { locale }),
    check_error: (locale) => m.report_skipped_check_error({}, { locale }),
    compressed: (locale) => m.report_skipped_compressed({}, { locale }),
    consent_wall: (locale) => m.report_skipped_consent_wall({}, { locale }),
    error_page: (locale) => m.report_skipped_error_page({}, { locale }),
    login_wall: (locale) => m.report_skipped_login_wall({}, { locale }),
    meta_refresh: (locale) => m.report_skipped_meta_refresh({}, { locale }),
    no_certificate: (locale) => m.report_skipped_no_certificate({}, { locale }),
    no_headings: (locale) => m.report_skipped_no_headings({}, { locale }),
    no_robots: (locale) => m.report_skipped_no_robots({}, { locale }),
    no_sample: (locale) => m.report_skipped_no_sample({}, { locale }),
    not_html: (locale) => m.report_skipped_not_html({}, { locale }),
    not_offered: (locale) => m.report_skipped_not_offered({}, { locale }),
    robots_error: (locale) => m.report_skipped_robots_error({}, { locale }),
    too_deep: (locale) => m.report_skipped_too_deep({}, { locale }),
    truncated: (locale) => m.report_skipped_truncated({}, { locale }),
    unreachable: (locale) => m.report_skipped_unreachable({}, { locale }),
};

/** Why a check was not checked, in words. A check with no result at all never ran (the scan ended first); an unknown reason code gets the general sentence. */
export const skippedReasonLabel = (result: CheckResult | undefined, locale: Locale): string => {
    if (result === undefined) return m.report_skipped_not_run({}, { locale });
    return SKIPPED_REASONS[result.skippedReason ?? '']?.(locale) ?? m.report_skipped_other({}, { locale });
};

/**
 * What the table shows as the measured value: the page's own header when the check has one (shown as it is), otherwise up to three of the
 * values it measured, with readable labels and units. `raw` says which, so a header can be set in code type and a sentence cannot.
 */
export const valueSummary = (row: ReportRow, locale: Locale = 'en'): { text: string; raw: boolean } => {
    const header = row.result?.evidence['value'];
    if (typeof header === 'string' && header !== '') return { text: header, raw: true };
    const parts = evidenceEntries(row.result)
        .slice(0, 3)
        .map(([name, value]) => `${evidenceLabel(name)} ${evidenceValue(name, value, locale).text}`);
    return { text: parts.join(' · '), raw: false };
};
