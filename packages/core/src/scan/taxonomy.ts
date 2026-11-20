/**
 * The words of the check model (categories, groups, severities…) and the weight of each severity: plain values, apart
 * from the schemas in `check.ts`, so a page that only names categories does not load the schema library with them.
 */
export const CATEGORIES = ['security', 'speed', 'seo', 'privacy', 'agent', 'email'] as const;
/** A section of the report inside a category: what a person looks at together. A new kind of check adds a group here and its title in the frontend messages. */
export const GROUPS = ['https', 'headers', 'cookies', 'content', 'page', 'indexing', 'social', 'files', 'agent_access', 'agent_content', 'agent_discovery', 'speed_server', 'speed_page'] as const;
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const EFFORTS = ['minutes', 'hours', 'days'] as const;
export const CHECK_STATUSES = ['pass', 'warn', 'fail', 'skipped'] as const;
export const LAYERS = ['light', 'heavy'] as const;

export type Category = (typeof CATEGORIES)[number];
export type Group = (typeof GROUPS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Effort = (typeof EFFORTS)[number];
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export type Layer = (typeof LAYERS)[number];

export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 8, high: 5, medium: 3, low: 1 };
