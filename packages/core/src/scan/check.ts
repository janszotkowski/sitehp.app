import * as z from 'zod/mini';
import type { AddressProbe, AssetSample, CertificateInfo, FetchedPage, HttpProbe, MarkdownProbe, SiteFile, SitemapSample } from './page.ts';
import type { ScanUrl } from './url.ts';
import { CATEGORIES, CHECK_STATUSES, EFFORTS, LAYERS, SEVERITIES, SEVERITY_WEIGHT, type Category, type CheckStatus, type Effort, type Group, type Layer, type Severity } from './taxonomy.ts';

export * from './taxonomy.ts';

/** The measured value behind a result: simple values only, so it is safe to store and to show. */
export const evidenceSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * The unified shape of one check's result, the same on the worker, the wire and
 * the screen. It carries no prose: the explanation is looked up by `checkId`
 * in the language of the page.
 */
export const checkResultSchema = z.object({
    checkId: z.string().check(z.minLength(1)),
    category: z.enum(CATEGORIES),
    layer: z.enum(LAYERS),
    status: z.enum(CHECK_STATUSES),
    severity: z.enum(SEVERITIES),
    effort: z.enum(EFFORTS),
    evidence: evidenceSchema,
    /** Points taken off the category: the full weight for `fail`, half for `warn`, nothing otherwise. */
    pointsLost: z.number().check(z.nonnegative()),
    /** Why a check did not run (`skipped` only). A machine reason, not user prose. */
    skippedReason: z.optional(z.string()),
});

export type CheckResult = z.infer<typeof checkResultSchema>;

/** What a check needs. It grows with the layers (DNS, TLS, a rendered page); today the target and the fetched page. */
export type CheckContext = {
    url: ScanUrl;
    /** The fetched page. Absent only in contexts built without a fetch (a check that needs it reports itself `skipped`). */
    page?: FetchedPage;
    /** The certificate on port 443: `null` when nothing answered with TLS, absent when it was not looked at. */
    certificate?: CertificateInfo | null;
    /** The plain-http entry point: `null` when nothing answered on port 80, absent when it was not looked at. */
    httpProbe?: HttpProbe | null;
    /** `/robots.txt`: `null` when nothing answered, absent when it was not looked at. A 404 is a file with status 404, not `null`. */
    robots?: SiteFile | null;
    /** The sitemap named in `robots.txt`, or `/sitemap.xml`: `null` when nothing answered, absent when it was not looked at. */
    sitemap?: SiteFile | null;
    /** A few URLs from the sitemap, fetched to see that they answer. Empty when there is none or it is an index of other sitemaps. */
    sitemapSample?: readonly SitemapSample[];
    /** A few stylesheets and scripts the page links on its own site, fetched. Empty when there is none or none answered. */
    assetSample?: readonly AssetSample[];
    /** Small files an agent looks for under `/.well-known/`, by path: `null` when nothing answered, absent when they were not looked at. */
    agentFiles?: Readonly<Record<string, SiteFile | null>>;
    /** `/llms.txt`: `null` when nothing answered, absent when it was not looked at. */
    llms?: SiteFile | null;
    /** The scanned page asked for as `text/markdown`: `null` when nothing answered, absent when it was not looked at. */
    markdown?: MarkdownProbe | null;
    /** A page that does not exist (a made-up path): what a missing page answers with. */
    notFound?: AddressProbe | null;
    /** The same site on its other host name (`www` added or removed). Absent when there is no such name to try. */
    hostVariant?: AddressProbe | null;
};

/**
 * The context a real scan hands the checks: every field a check reads is gathered, so forgetting one fails to compile instead of
 * quietly turning checks `skipped`. Only `page` (none behind a bad certificate) and `hostVariant` (a host with no other name) may be absent.
 */
export type GatheredContext = CheckContext & Required<Omit<CheckContext, 'page' | 'hostVariant'>>;

/** A check may report itself `skipped` when there is nothing to measure; `skippedReason` then says why. */
export type CheckOutcome = { status: Exclude<CheckStatus, 'skipped'>; evidence: Evidence } | { status: 'skipped'; evidence: Evidence; skippedReason: string };

/** What a check is, without how it runs: all a page needs to list, group and weigh it. */
export type CheckMeta = {
    id: string;
    category: Category;
    /** The report section this check is listed under. Not on the wire: the page looks it up by `checkId`. */
    group: Group;
    layer: Layer;
    severity: Severity;
    effort: Effort;
};

/** A check is a pure function of its context: no I/O of its own, so it is testable and reusable in the CLI. */
export type CheckDefinition = CheckMeta & {
    run: (context: CheckContext) => CheckOutcome | Promise<CheckOutcome>;
};

const pointsLostFor = (status: CheckStatus, severity: Severity): number => {
    if (status === 'fail') return SEVERITY_WEIGHT[severity];
    if (status === 'warn') return SEVERITY_WEIGHT[severity] / 2;
    return 0;
};

/**
 * Runs one check and always returns a result: a check that throws becomes
 * `skipped` with a reason, and the scan goes on. One failing check never
 * fails a scan.
 */
export const runCheck = async (definition: CheckDefinition, context: CheckContext): Promise<CheckResult> => {
    const base = { checkId: definition.id, category: definition.category, layer: definition.layer, severity: definition.severity, effort: definition.effort };
    try {
        const outcome = await definition.run(context);
        if (outcome.status === 'skipped') return { ...base, status: 'skipped', evidence: outcome.evidence, pointsLost: 0, skippedReason: outcome.skippedReason };
        return { ...base, status: outcome.status, evidence: outcome.evidence, pointsLost: pointsLostFor(outcome.status, definition.severity) };
    } catch {
        return { ...base, status: 'skipped', evidence: {}, pointsLost: 0, skippedReason: 'check_error' };
    }
};
