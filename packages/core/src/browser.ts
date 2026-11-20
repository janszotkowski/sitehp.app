// What a browser may import: the contract, the client, the check catalog, the score model and URL helpers.
// Nothing here reaches the check runners, so they and parse5 stay out of client bundles.
export * from './contract/index.ts';
export * from './client/index.ts';
export { scoreBand, scoreColor, scoreColorHex, type ScoreBand, type ScoreTheme } from './score-color.ts';
// The plain words of the model from their own module, so naming a category does not load the schemas.
export {
    CATEGORIES,
    CHECK_STATUSES,
    EFFORTS,
    GROUPS,
    LAYERS,
    SEVERITIES,
    SEVERITY_WEIGHT,
    type Category,
    type CheckStatus,
    type Effort,
    type Group,
    type Layer,
    type Severity,
} from './scan/taxonomy.ts';
export { DESCRIPTION_LENGTH, EXPIRY_DAYS, HSTS_MIN_SECONDS, HTML_BYTES, RESOURCES, TITLE_LENGTH, TTFB_MS, WORDS } from './scan/limits.ts';
export { checkResultSchema, evidenceSchema, type CheckMeta, type CheckResult, type Evidence } from './scan/check.ts';
// The catalog under the registry's name: the same list, in the same order, without `run`.
export { CHECK_CATALOG as CHECKS, ALWAYS_CHECKED, catalogFor, normalizeSelection } from './scan/catalog.ts';
export { CATEGORY_WEIGHT, CRITICAL_CAP, SCORE_MODEL_VERSION, computeScore, fixGain, scoreBreakdown, simulateFix, type CategoryScore, type ScoreBreakdown } from './scan/score.ts';
export { TECHNOLOGIES, type Technology } from './scan/technology.ts';
export { emptySnapshot, isFinished, reduceScan } from './scan/state.ts';
export { displayUrl, domainToUnicode } from './scan/domain.ts';
export { MAX_URL_LENGTH, hideQueryValues, normalizeUrl, type NormalizeUrlResult, type ScanUrl, type UrlRejection } from './scan/url.ts';
