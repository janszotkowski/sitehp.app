import type { CheckResult } from './check.ts';
import { CATEGORIES, SEVERITY_WEIGHT, type Category } from './taxonomy.ts';

/** True when the page itself answered 401, 403 or 429: `http_status` then skips with reason `blocked`. */
export const turnedAway = (results: readonly CheckResult[]): boolean => results.some((result) => result.checkId === 'http_status' && result.status === 'skipped' && result.skippedReason === 'blocked');

/** Bumped whenever the weights or the rules below change; a stored score is only comparable within one version. */
export const SCORE_MODEL_VERSION = 5;

/** How much each category counts towards the HP. A category with no check that ran is left out and the rest share its weight, so a missing area never lowers the score. Email is 0: dropped from the plan. */
export const CATEGORY_WEIGHT: Record<Category, number> = { security: 40, seo: 30, speed: 15, privacy: 15, agent: 10, email: 0 };

/** A failed critical check (an untrusted certificate, a site only on http, an error page, a page told not to be indexed or blocked in robots.txt) holds the HP at this value, the top of the "poor" band, however well the rest does. */
export const CRITICAL_CAP = 59;

export type CategoryScore = {
    category: Category;
    /** 0–100, from this category's checks only. */
    score: number;
    /** Share of the HP this category carries, 0–1; the shares of the categories that ran add up to 1. */
    share: number;
    /** How many of its checks ran (skipped ones do not count). */
    checks: number;
    /** How many of its checks there were, skipped ones included: "`checks` of `total` ran". */
    total: number;
};

export type ScoreBreakdown = {
    score: number;
    categories: CategoryScore[];
    capped: boolean;
    /** The failed critical checks that hold the HP at `CRITICAL_CAP`; empty when `capped` is false. */
    cappedBy: string[];
};

const weightOf = (results: readonly CheckResult[]): number => results.reduce((sum, result) => sum + SEVERITY_WEIGHT[result.severity], 0);

/** The unrounded model. `null` when nothing ran yet, when only a zero-weight category ran, or when the page turned the scanner away. */
const breakdownOf = (results: readonly CheckResult[]): { raw: number; categories: CategoryScore[]; capped: boolean; cappedBy: string[] } | null => {
    // The site turned the scanner away, so what ran says nothing about it.
    if (turnedAway(results)) return null;
    const ran = results.filter((result) => result.status !== 'skipped');
    const own = CATEGORIES.flatMap((category) => {
        const checks = ran.filter((result) => result.category === category);
        const weight = CATEGORY_WEIGHT[category];
        if (checks.length === 0 || weight === 0) return [];
        const lost = checks.reduce((sum, result) => sum + result.pointsLost, 0);
        const total = results.filter((result) => result.category === category).length;
        return [{ category, weight, checks: checks.length, total, raw: 100 - (100 * lost) / weightOf(checks) }];
    });
    const totalWeight = own.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight === 0) return null;

    const uncapped = own.reduce((sum, item) => sum + (item.raw * item.weight) / totalWeight, 0);
    const failedCritical = ran.filter((result) => result.severity === 'critical' && result.status === 'fail').map((result) => result.checkId);
    const critical = failedCritical.length > 0;
    const capped = critical && uncapped > CRITICAL_CAP;
    const categories = own.map((item) => ({ category: item.category, score: Math.round(item.raw), share: item.weight / totalWeight, checks: item.checks, total: item.total }));
    return { raw: critical ? Math.min(uncapped, CRITICAL_CAP) : uncapped, categories, capped, cappedBy: capped ? failedCritical : [] };
};

const toHp = (raw: number): number => Math.max(0, Math.min(100, Math.round(raw)));

/** The HP and how it came about: the score per category, and whether a critical failure held it down. `null` as in `computeScore`. */
export const scoreBreakdown = (results: readonly CheckResult[]): ScoreBreakdown | null => {
    const model = breakdownOf(results);
    return model === null ? null : { score: toHp(model.raw), categories: model.categories, capped: model.capped, cappedBy: model.cappedBy };
};

/** The HP, 0–100: each category's kept share of its weighted points, averaged by `CATEGORY_WEIGHT`, then held at `CRITICAL_CAP` after a critical failure. Skipped checks are left out. */
export const computeScore = (results: readonly CheckResult[]): number | null => scoreBreakdown(results)?.score ?? null;

const fixed = (results: readonly CheckResult[], checkIds: readonly string[]): CheckResult[] =>
    results.map((result) => (checkIds.includes(result.checkId) && result.status !== 'skipped' ? { ...result, status: 'pass', pointsLost: 0 } : result));

/** The HP as if the given checks had passed (a skipped one stays skipped). Powers "fix these and gain +X". */
export const simulateFix = (results: readonly CheckResult[], checkIds: readonly string[]): number | null => computeScore(fixed(results, checkIds));

/**
 * HP a person gains by fixing one check, with one decimal because a small fix is worth less than a point. Zero for a check that
 * costs nothing, was skipped or is unknown, on a blocked page, and for a fix that a critical failure elsewhere still holds down.
 */
export const fixGain = (results: readonly CheckResult[], checkId: string): number => {
    const before = breakdownOf(results);
    const after = breakdownOf(fixed(results, [checkId]));
    if (before === null || after === null) return 0;
    return Math.round(10 * (after.raw - before.raw)) / 10;
};
