import { catalogFor, isFinished, scoreBreakdown, type ScanSnapshot, type ScoreBreakdown } from '@sitehp.app/core/browser';
import { blockedStatus, isAttention, reportRows, STATUS_RANK, type ReportRow } from '@lib/reportModel';
import { olderScoreModel } from '@lib/scanSnapshot';

/** The three parts every written-out report has: what to fix in order (worst status, then the biggest gain), what passed, what was not measured. */
export type ReportSections = { todo: ReportRow[]; passed: ReportRow[]; unmeasured: ReportRow[] };

export const reportSections = (rows: readonly ReportRow[]): ReportSections => ({
    todo: rows.filter(isAttention).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.gain - a.gain),
    passed: rows.filter((row) => row.status === 'pass'),
    unmeasured: rows.filter((row) => row.status === 'skipped' || row.status === 'running'),
});

/**
 * The HP a report may show outside its own page (badge, share image): only a finished scan of every check has one.
 * A scan of a choice of checks has no HP to show off: picking only the checks a site passes would make any site a 100.
 */
export const shareableScore = (snapshot: Pick<ScanSnapshot, 'status' | 'score' | 'selectedChecks'>): number | null =>
    snapshot.status === 'completed' && snapshot.selectedChecks === undefined ? snapshot.score : null;

/** Everything a reader of one report needs worked out of its snapshot, so the page, the printout, the exports and the share image agree. */
export type ReportView = {
    /** A customized scan lists only the checks it ran; the rest were never asked for, not skipped. */
    rows: ReportRow[];
    sections: ReportSections;
    customized: boolean;
    /** The status a bot wall answered with (there is no score then), else null. */
    blocked: number | null;
    /** The score model of a finished report scored before today's, else undefined. */
    olderModel: number | undefined;
    /** The categories that add up to the HP on the report; null when they would not (an earlier model) or there is no score. */
    breakdown: ScoreBreakdown | null;
    /** The HP for the badge and the share image (see `shareableScore`). */
    shareScore: number | null;
    /** The categories for the share image: only next to a score it may show. */
    shareBreakdown: ScoreBreakdown | null;
};

export const reportView = (snapshot: ScanSnapshot): ReportView => {
    const rows = reportRows(snapshot.checks, isFinished(snapshot), catalogFor(snapshot.selectedChecks));
    const olderModel = olderScoreModel(snapshot);
    const breakdown = olderModel === undefined ? scoreBreakdown(snapshot.checks) : null;
    const shareScore = shareableScore(snapshot);
    return {
        rows,
        sections: reportSections(rows),
        customized: snapshot.selectedChecks !== undefined,
        blocked: blockedStatus(snapshot.checks),
        olderModel,
        breakdown,
        shareScore,
        shareBreakdown: shareScore === null ? null : breakdown,
    };
};
