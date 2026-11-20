import * as z from 'zod/mini';
import { checkResultSchema } from '../scan/check.ts';
import { TECHNOLOGIES, type Technology } from '../scan/technology.ts';
import { eventEnvelope, eventIdSchema } from './events.ts';

/** Technology ids, with ones this build does not know dropped: frontend and backend deploy apart, and a new id must not fail a whole report. */
const technologiesSchema = z.pipe(
    z.array(z.string()),
    z.transform((ids) => ids.filter((id): id is Technology => (TECHNOLOGIES as readonly string[]).includes(id))),
);

/**
 * The public id of a report: 128 random bits as 22 URL-safe characters. It is the
 * only thing that gives access to a report, so it must never be sequential or
 * guessable (see the architecture, "Reports are not indexed").
 */
export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const publicIdSchema = z.string().check(z.regex(PUBLIC_ID_PATTERN));

export const SCAN_STATUSES = ['running', 'completed', 'failed'] as const;

/**
 * Why a scan could not be completed. Machine reasons: the client chooses the words.
 * `blocked_address` is the answer to an address that resolves to a private or internal
 * network; `unreachable` covers a name that does not resolve and a connection that fails.
 */
export const SCAN_FAILURE_REASONS = ['blocked_address', 'unreachable', 'timeout', 'too_many_redirects', 'tls_error', 'invalid_response', 'internal_error'] as const;

export type ScanFailureReason = (typeof SCAN_FAILURE_REASONS)[number];

/** `POST /v1/scans` */
export const createScanRequestSchema = z.object({
    url: z.string().check(z.minLength(1), z.maxLength(2048)),
    /** Scan anew even when the same address was scanned in the last few minutes (after fixing something, say). */
    fresh: z.optional(z.boolean()),
    /** Run only these checks (by id) instead of all of them. The server adds the ones that must always run and refuses an unknown id. */
    checks: z.optional(z.array(z.string().check(z.minLength(1), z.maxLength(64))).check(z.minLength(1), z.maxLength(200))),
});

export type CreateScanRequest = z.infer<typeof createScanRequestSchema>;

/** Everything a client needs to draw a report right now. The stream continues from `lastEventId`. */
export const scanSnapshotSchema = z.object({
    publicId: publicIdSchema,
    status: z.enum(SCAN_STATUSES),
    url: z.string(),
    domain: z.string(),
    createdAt: z.iso.datetime(),
    totalChecks: z.int().check(z.nonnegative()),
    checks: z.array(checkResultSchema),
    /** `null` until the first check has run. */
    score: z.nullable(z.int().check(z.gte(0), z.lte(100))),
    /** True while checks are still running: the score may still change. */
    preliminary: z.boolean(),
    /** Set when `status` is `failed`: why, so a page opened after the failure can say it. */
    failureReason: z.nullable(z.enum(SCAN_FAILURE_REASONS)),
    /** The response headers of the scanned page (never `set-cookie`), shown as the raw view. `null` until the page is fetched. */
    responseHeaders: z.nullable(z.record(z.string(), z.string())),
    /** What the site is built with or served by (`detectTechnologies`), empty when nothing was recognised. Absent from reports stored before it existed. */
    technologies: z.optional(technologiesSchema),
    /** The checks this scan runs, by id, when it was started with a choice. Absent for a full scan, and for reports stored before it existed. */
    selectedChecks: z.optional(z.array(z.string())),
    /** Id of the last event folded into this snapshot, or `null` before the first one. Resume the stream after it. */
    lastEventId: z.nullable(eventIdSchema),
    /**
     * The version of the score model `score` was computed with (`SCORE_MODEL_VERSION` of the worker that completed the scan): scores
     * compare only within one version. `null` until the scan completes, and for a failed scan; absent from reports stored before it existed.
     */
    scoreModelVersion: z.optional(z.nullable(z.int().check(z.positive()))),
    /**
     * The backend's own bookkeeping, kept in the stored snapshot: the worker run that owns the scan, so a run that was taken over is refused.
     * A response never carries it, and folding the stream never sets it.
     */
    runId: z.optional(z.nullable(z.string())),
});

export type ScanSnapshot = z.infer<typeof scanSnapshotSchema>;

export const createScanResponseSchema = z.object({
    publicId: publicIdSchema,
    snapshot: scanSnapshotSchema,
});

export type CreateScanResponse = z.infer<typeof createScanResponseSchema>;

/** The scan events. A discriminated union on `type`; the stream never sends anything else. */
/** `runId` names the worker run that started (absent when the API queues the scan): from then on only that run may add events. */
export const scanStartedEventSchema = eventEnvelope('scan.started', z.object({ url: z.string(), domain: z.string(), totalChecks: z.int().check(z.nonnegative()), runId: z.optional(z.string()) }));
export const pageFetchedEventSchema = eventEnvelope('page.fetched', z.object({ headers: z.record(z.string(), z.string()), technologies: z.optional(technologiesSchema) }));
export const checkCompletedEventSchema = eventEnvelope('check.completed', checkResultSchema);
export const scoreUpdatedEventSchema = eventEnvelope('score.updated', z.object({ score: z.int().check(z.gte(0), z.lte(100)), preliminary: z.literal(true) }));
/** `scoreModelVersion`: the score model the score was computed with (absent from events stored before it existed). */
export const scanCompletedEventSchema = eventEnvelope(
    'scan.completed',
    z.object({ score: z.nullable(z.int().check(z.gte(0), z.lte(100))), scoreModelVersion: z.optional(z.int().check(z.positive())) }),
);
export const scanFailedEventSchema = eventEnvelope('scan.failed', z.object({ reason: z.enum(SCAN_FAILURE_REASONS) }));

export const scanEventSchema = z.discriminatedUnion('type', [
    scanStartedEventSchema,
    pageFetchedEventSchema,
    checkCompletedEventSchema,
    scoreUpdatedEventSchema,
    scanCompletedEventSchema,
    scanFailedEventSchema,
]);

export type ScanEvent = z.infer<typeof scanEventSchema>;
export type ScanEventType = ScanEvent['type'];

/** After one of these the stream is over: no reconnect, nothing more to fold. */
export const isTerminalScanEvent = (event: ScanEvent): boolean => event.type === 'scan.completed' || event.type === 'scan.failed';
