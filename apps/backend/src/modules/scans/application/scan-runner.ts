import { randomUUID } from 'node:crypto';
import {
    checksFor,
    SCORE_MODEL_VERSION,
    computeScore,
    detectTechnologies,
    hideQueryValues,
    normalizeUrl,
    runCheck,
    scoreBreakdown,
    type CheckResult,
    type ScanFailureReason,
    type ScanSnapshot,
} from '@sitehp.app/core';
import { urlForLog, type Logger } from '@platform/logger.ts';
import type { Clock } from '@platform/ports.ts';
import { registrableDomain } from '@platform/net/registrable-domain.ts';
import { publisherOf } from '@modules/scans/application/publish.ts';
import { gatherSite } from '@modules/scans/application/site-probes.ts';
import { RunTakenOverError, ScanFinishedError, type JobQueue, type ScanEventDraft, type ScanJob, type ScanStore, type SiteFetcher, type SiteLog } from '@modules/scans/ports.ts';

export type ScanRunnerDeps = {
    store: ScanStore;
    /** The permanent list of scanned domains: a finished full scan records its score there. */
    siteLog: SiteLog;
    fetcher: SiteFetcher;
    /** Whether a scan's job still exists, so the reaper leaves a scan that is only waiting alone. */
    isPending: JobQueue['isPending'];
    clock: Clock;
    logger: Logger;
    /** Pause before each check, so a person can watch a scan fill in. 0 in production. */
    stepDelayMs: number;
    /** The whole run of one scan (`SCAN_DEADLINE_MS`): past it the scan is stopped and failed as `timeout`. */
    deadlineMs?: number;
};

const MAX_RAW_HEADERS = 60;
const MAX_RAW_HEADER_LENGTH = 1000;

const DEFAULT_DEADLINE_MS = 120_000;

const pause = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** Running a scan: the worker side. It fetches the site, runs the checks, publishes every step, and ends scans whose run was lost. */
export const createScanRunner = (deps: ScanRunnerDeps) => {
    const { store, clock } = deps;
    const publish = publisherOf(store, deps.logger);
    const now = () => clock.now().toISOString();

    /** How a finished scan turned out, for the log: counts by status and the ids that need a look. */
    const outcomeOf = (checks: readonly CheckResult[]) => {
        const by = (status: CheckResult['status']) => checks.filter((check) => check.status === status).map((check) => check.checkId);
        const failed = by('fail');
        const warned = by('warn');
        return {
            checks: { pass: by('pass').length, warn: warned.length, fail: failed.length, skipped: by('skipped').length },
            failed,
            warned,
            skipped: checks.filter((check) => check.status === 'skipped').map((check) => `${check.checkId}:${check.skippedReason ?? '?'}`),
        };
    };

    /**
     * Ends a scan as failed. A scan that has already ended refuses it, which is fine. Any other failure to write it is logged and thrown:
     * the job then fails, and the reaper ends the scan once its job is gone, instead of the scan staying `running` unnoticed.
     */
    const endFailed = (publicId: string, reason: ScanFailureReason, log: Logger, runId?: string): Promise<void> =>
        publish(publicId, { type: 'scan.failed', ts: now(), data: { reason } }, undefined, runId).then(
            () => undefined,
            (error: unknown) => {
                if (error instanceof ScanFinishedError) return;
                log.error({ err: error, reason }, 'ending the scan as failed did not work');
                throw error;
            },
        );

    /**
     * The worker side: fetches the page once, runs every check, publishing an event after each, and ends with `scan.completed` (or `scan.failed` with the reason).
     * The whole run has a deadline: past it the fetches still going are aborted, the scan is failed as `timeout` and the job ends, so a site
     * that answers slowly on every probe, or a database that stops answering, cannot hold a worker slot and a report for ever.
     */
    const run = async (job: ScanJob): Promise<void> => {
        const startedAt = performance.now();
        const elapsed = () => Math.round(performance.now() - startedAt);
        const log = deps.logger.child({ publicId: job.publicId });
        const deadlineMs = deps.deadlineMs ?? DEFAULT_DEADLINE_MS;
        const controller = new AbortController();
        // This run's own id: if a stall hands the job to another worker, the store refuses whatever this run still publishes.
        const runId = randomUUID();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<'expired'>((resolve) => {
            timer = setTimeout(() => resolve('expired'), deadlineMs);
        });
        try {
            if ((await Promise.race([runUntil(job, runId, controller.signal, log, elapsed), expired])) !== 'expired') return;
        } finally {
            clearTimeout(timer);
        }
        // The run goes on in the background until it notices: its fetches are aborted, and its next event is refused once the scan has ended.
        controller.abort();
        log.warn({ durationMs: elapsed(), deadlineMs }, 'scan over its deadline, stopped');
        await endFailed(job.publicId, 'timeout', log, runId);
    };

    const runUntil = async ({ publicId, url: typedUrl, httpFallback }: ScanJob, runId: string, signal: AbortSignal, log: Logger, elapsed: () => number): Promise<void> => {
        const publishAsRun = (draft: ScanEventDraft, derive?: (snapshot: ScanSnapshot) => ScanEventDraft | undefined) => publish(publicId, draft, derive, runId);
        try {
            let snapshot = await store.get(publicId);
            if (snapshot === undefined) throw new Error('the scan of a job is not stored');
            // A job that comes back for a scan that already ended (it was queued twice, or its worker died after the last event) has nothing to do.
            if (snapshot.status !== 'running') {
                log.info({ status: snapshot.status }, 'scan already finished, job skipped');
                return;
            }
            // More than `scan.started` in the log: an earlier worker died part-way. A scan created by another version (a deploy between
            // the API queueing it and this worker running it) has another set of checks. Either way the run starts over with a new
            // `scan.started`, which clears the earlier results and sets the number of checks this version runs.
            const selected = checksFor(snapshot.selectedChecks);
            const resumed = Number(snapshot.lastEventId ?? 0) > 1;
            if (resumed) log.warn({ lastEventId: snapshot.lastEventId }, 'scan resumed after a lost worker');
            if (resumed || snapshot.totalChecks !== selected.length) {
                if (!resumed) log.info({ queuedWith: snapshot.totalChecks, runsWith: selected.length }, 'scan queued by another version, checks recounted');
                snapshot = await publishAsRun({ type: 'scan.started', ts: now(), data: { url: snapshot.url, domain: snapshot.domain, totalChecks: selected.length, runId } });
            }
            const typed = normalizeUrl(typedUrl ?? snapshot.url);
            if (!typed.ok) throw new Error('a stored scan has an invalid URL');
            const domain = snapshot.domain;
            log.info({ domain, queueWaitMs: Math.max(0, clock.now().getTime() - Date.parse(snapshot.createdAt)) }, 'scan started');

            const { url, fetched, httpEntry, context } = await gatherSite(deps.fetcher, typed.url, { httpFallback: httpFallback === true, signal });
            if (signal.aborted) return;
            // Scanned over http after all: the report names the address that was scanned (the stored `url` column stays the one asked for).
            if (url.scheme !== typed.url.scheme) {
                log.info({ domain, from: typed.url.scheme, to: url.scheme }, 'https did not answer, scanned over http');
                snapshot = await publishAsRun({ type: 'scan.started', ts: now(), data: { url: hideQueryValues(url.href), domain, totalChecks: selected.length, runId } });
            }
            const status = (file: { status: number } | null | undefined): number | null => file?.status ?? null;
            log.info(
                {
                    domain,
                    durationMs: elapsed(),
                    page: fetched.ok
                        ? {
                              status: fetched.page.status,
                              finalHost: urlForLog(fetched.page.finalUrl).host,
                              redirects: fetched.page.redirects.length,
                              bytes: fetched.page.bytes,
                              truncated: fetched.page.truncated,
                              contentType: fetched.page.contentType,
                              ttfbMs: fetched.page.ttfbMs,
                              totalMs: fetched.page.totalMs,
                          }
                        : { failure: fetched.reason },
                    httpEntry: httpEntry.ok ? { status: httpEntry.page.status, finalScheme: httpEntry.page.finalUrl.startsWith('https:') ? 'https' : 'http' } : { failure: httpEntry.reason },
                    certificate: context.certificate === null ? null : { authorized: context.certificate.authorized, error: context.certificate.error, daysLeft: context.certificate.daysLeft },
                    files: {
                        robots: status(context.robots),
                        sitemap: status(context.sitemap),
                        sitemapSampled: context.sitemapSample.length,
                        assetsSampled: context.assetSample.length,
                        llms: status(context.llms),
                        agentFiles: Object.values(context.agentFiles).filter((file) => file !== null).length,
                        markdown: context.markdown === null ? null : { status: context.markdown.status, contentType: context.markdown.contentType },
                        notFound: status(context.notFound),
                        otherHost: context.hostVariant === undefined ? 'none' : status(context.hostVariant),
                    },
                },
                'site contacted',
            );
            // A bad certificate is a finding, not the end: the scan goes on without a page, and the checks that need one are reported as not checked.
            // Any other failure to reach the site ends the scan with the reason.
            if (!fetched.ok && fetched.reason !== 'tls_error') {
                await publishAsRun({ type: 'scan.failed', ts: now(), data: { reason: fetched.reason } });
                log.warn({ domain, reason: fetched.reason, durationMs: elapsed() }, 'scan failed');
                return;
            }
            const page = context.page;

            // For the raw view only. `set-cookie` never leaves the fetch (cookies are judged, not kept), and the size is capped.
            const headers = Object.fromEntries(
                Object.entries(page?.headers ?? {})
                    .filter(([name]) => name !== 'set-cookie')
                    .slice(0, MAX_RAW_HEADERS)
                    .map(([name, value]) => [name, value.slice(0, MAX_RAW_HEADER_LENGTH)]),
            );
            let current = page === undefined ? snapshot : await publishAsRun({ type: 'page.fetched', ts: now(), data: { headers, technologies: detectTechnologies(page) } });
            for (const check of selected) {
                await pause(deps.stepDelayMs);
                if (signal.aborted) return;
                const checkStartedAt = performance.now();
                const result = await runCheck(check, context);
                log.debug(
                    {
                        checkId: result.checkId,
                        category: result.category,
                        status: result.status,
                        severity: result.severity,
                        pointsLost: result.pointsLost,
                        ...(result.skippedReason === undefined ? {} : { skippedReason: result.skippedReason }),
                        durationMs: Math.round(performance.now() - checkStartedAt),
                    },
                    'check completed',
                );
                current = await publishAsRun({ type: 'check.completed', ts: now(), data: result }, (checked) => {
                    const score = computeScore(checked.checks);
                    return score === null ? undefined : { type: 'score.updated', ts: now(), data: { score, preliminary: true } };
                });
            }

            const breakdown = scoreBreakdown(current.checks);
            const score = breakdown?.score ?? null;
            await publishAsRun({ type: 'scan.completed', ts: now(), data: { score, scoreModelVersion: SCORE_MODEL_VERSION } });
            log.info(
                {
                    domain,
                    score,
                    scoreCapped: breakdown?.capped ?? false,
                    categories: Object.fromEntries((breakdown?.categories ?? []).map((category) => [category.category, category.score])),
                    ...outcomeOf(current.checks),
                    durationMs: elapsed(),
                },
                'scan completed',
            );
            // A choice of checks is not how the site did: its score must not replace the last full one.
            if (current.selectedChecks === undefined) {
                await deps.siteLog
                    .recordResult(registrableDomain(domain), score, new Date(current.createdAt))
                    .catch((error: unknown) => deps.logger.warn({ err: error, domain }, 'recording a result failed'));
            }
        } catch (error) {
            // Ended elsewhere while this ran (the reaper failed it, another worker finished it): stop, the scan already has its end.
            // Taken over by another run (this one stalled and BullMQ handed the job on): that run owns the scan now.
            if (error instanceof ScanFinishedError) {
                log.warn({ durationMs: elapsed() }, error instanceof RunTakenOverError ? 'scan taken over by another run, run stopped' : 'scan ended elsewhere, run stopped');
                return;
            }
            // Out of time: the deadline has already ended the scan.
            if (signal.aborted) return;
            // One failing scan reports itself and never takes the process down. The visitor sees `internal_error`; the log keeps the cause.
            log.error({ err: error, durationMs: elapsed() }, 'scan job failed');
            await endFailed(publicId, 'internal_error', log, runId);
        }
    };

    /**
     * Fails the scans that are `running` with no event for `maxAgeMs` and whose job is gone (Redis lost it, a worker was killed for good, the
     * job ran out of attempts): a report must not wait for ever. A scan still waiting in a long queue or still running is left alone, and so
     * is one the queue cannot answer for (Redis away is not a lost job). A scan that finishes meanwhile is refused by the store.
     */
    const reapStuck = async (maxAgeMs: number): Promise<number> => {
        const stuck = await store.listRunningIdleSince(new Date(clock.now().getTime() - maxAgeMs));
        let failed = 0;
        for (const publicId of stuck) {
            try {
                if (await deps.isPending(publicId)) continue;
                await publish(publicId, { type: 'scan.failed', ts: now(), data: { reason: 'internal_error' } });
                failed += 1;
                deps.logger.warn({ publicId, maxAgeMs }, 'stuck scan failed, its job was lost');
            } catch (error) {
                deps.logger.debug({ err: error, publicId }, 'stuck scan left alone');
            }
        }
        return failed;
    };

    /** The queue gave up on a scan's job (it stalled too often, or the run threw): the scan ends now instead of waiting for the reaper. */
    const failLost = (publicId: string): Promise<void> => endFailed(publicId, 'internal_error', deps.logger.child({ publicId }));

    return { run, reapStuck, failLost };
};

export type ScanRunner = ReturnType<typeof createScanRunner>;
