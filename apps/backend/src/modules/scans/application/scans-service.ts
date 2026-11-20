import { randomUUID } from 'node:crypto';
import {
    checksFor,
    normalizeSelection,
    SCORE_MODEL_VERSION,
    computeScore,
    detectTechnologies,
    emptySnapshot,
    hideQueryValues,
    normalizeUrl,
    reduceScan,
    runCheck,
    scoreBreakdown,
    type CheckResult,
    type ScanEvent,
    type ScanFailureReason,
    type ScanSnapshot,
    type UrlRejection,
} from '@sitehp.app/core';
import { AppError } from '@platform/errors.ts';
import { urlForLog, type Logger } from '@platform/logger.ts';
import type { Clock, IdGenerator } from '@platform/ports.ts';
import type { RateLimiter } from '@platform/rate-limit.ts';
import { IPV6_NETWORK_FACTOR, callerNetworkKey } from '@platform/net/ip.ts';
import { registrableDomain } from '@platform/net/registrable-domain.ts';
import { probeSite } from '@modules/scans/application/site-probes.ts';
import {
    RunTakenOverError,
    ScanFinishedError,
    type JobQueue,
    type ScanEventDraft,
    type ScanJob,
    type ScanStore,
    type SiteFetchResult,
    type SiteFetcher,
    type SiteLog,
    type SiteRequestOutcome,
} from '@modules/scans/ports.ts';

export type ScansDeps = {
    store: ScanStore;
    /** The permanent list of scanned domains. */
    siteLog: SiteLog;
    /** The block-list rule a host falls under (`*.ru`, `evil.example`), or undefined when it may be scanned. */
    blockedBy: (host: string) => string | undefined;
    queue: JobQueue;
    fetcher: SiteFetcher;
    ids: IdGenerator;
    clock: Clock;
    logger: Logger;
    /** Put the caller's address in the log lines (`LOG_CLIENT_IP`). */
    logClient: boolean;
    limiter: RateLimiter;
    limits: { perIp: number; perDomain: number; windowMs: number };
    /** A scan of the same address started this recently is handed out again (`SCAN_REUSE_MS`); 0 turns it off. */
    reuseMs?: number;
    /** Pause before each check, so a person can watch a scan fill in. 0 in production. */
    stepDelayMs: number;
    /** The whole run of one scan (`SCAN_DEADLINE_MS`): past it the scan is stopped and failed as `timeout`. */
    deadlineMs?: number;
};

const REJECTION_MESSAGE: Record<UrlRejection, string> = {
    EMPTY: 'The URL is empty.',
    TOO_LONG: 'The URL is too long.',
    INVALID: 'The URL is not valid.',
    UNSUPPORTED_SCHEME: 'Only http and https addresses can be scanned.',
    CREDENTIALS: 'The URL must not contain a user name or password.',
    CUSTOM_PORT: 'Addresses with a custom port cannot be scanned.',
    HOST_NOT_ALLOWED: 'This address cannot be scanned. Use a public domain name.',
};

const MAX_RAW_HEADERS = 60;
const MAX_RAW_HEADER_LENGTH = 1000;

/** Recent scans one caller may be handed per window, as a multiple of the scans it may start: a reuse fetches nothing, but it is still a database read. */
const REUSE_FACTOR = 10;

/** How long an `Idempotency-Key` stands for the scan it started. */
const IDEMPOTENCY_MS = 10 * 60_000;

/** `Idempotency-Key`s remembered at most; past it the oldest is forgotten, so new keys cannot fill the memory. */
const IDEMPOTENCY_MAX_KEYS = 10_000;

const DEFAULT_DEADLINE_MS = 120_000;

/** A snapshot as a client gets it: without the run bookkeeping of the store (`runId`), so it equals the state folded from the stream. */
const shown = (snapshot: ScanSnapshot): ScanSnapshot => {
    const copy = { ...snapshot };
    delete copy.runId;
    return copy;
};

const pause = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * The use-cases of a scan. Everything it touches is a port, so these run in
 * tests against in-memory adapters, and the same code runs against Postgres,
 * Redis and a queue later.
 */
export const createScansService = (deps: ScansDeps) => {
    const { store, queue, ids, clock, blockedBy } = deps;
    /** Requests with an `Idempotency-Key`, oldest first: what `createOnce` answers a repeat with. */
    const recentRequests = new Map<string, { at: number; scan: Promise<ScanSnapshot> }>();

    /**
     * The single path of every state change: the store appends the event (and the one `derive` adds) and folds it into the snapshot in one step.
     * `runId` ties the event to a worker run, so a run that was taken over cannot add to the scan (`foldForRun`).
     */
    const publish = (publicId: string, draft: ScanEventDraft, derive?: (snapshot: ScanSnapshot) => ScanEventDraft | undefined, runId?: string): Promise<ScanSnapshot> =>
        store.publish(publicId, draft, reduceScan, derive, runId).then(({ event, followUp, snapshot }) => {
            for (const published of followUp === undefined ? [event] : [event, followUp]) deps.logger.trace({ publicId, eventId: published.id, type: published.type }, 'event published');
            return snapshot;
        });

    const now = () => clock.now().toISOString();

    /** The caller's address, only when the settings allow it in a log. */
    const clientField = (client: string | undefined): { client?: string } => (deps.logClient && client !== undefined ? { client } : {});

    /** The list of domains is for the owner's overview: a failure to write to it is logged and never stops a scan. */
    const remember = (domain: string, outcome: SiteRequestOutcome): Promise<void> =>
        deps.siteLog.recordRequest(domain, clock.now(), outcome).catch((error: unknown) => deps.logger.warn({ err: error, domain }, 'recording a requested domain failed'));

    /** The limiter buckets of one caller under `prefix`: its address, and for IPv6 its /48 with a looser limit. */
    const callerLimitsOf = (client: string, prefix: string, perIp: number) => {
        const network = callerNetworkKey(client);
        return [{ key: `${prefix}:${client}`, limit: perIp }, ...(network === undefined ? [] : [{ key: `${prefix}:${network}`, limit: perIp * IPV6_NETWORK_FACTOR }])];
    };

    /**
     * One scan per call makes the scanner fetch a stranger's site, so the caller's address and the domain are both limited.
     * A refused request counts against neither, so being refused for the domain does not also use up the caller's own limit.
     * The domain is the registrable one, so made-up subdomains of one server share its count. When that count is full and the same
     * URL (without query values) finished a scan within the window, that report is handed out instead (counted against the caller only), so a popular
     * site is not locked for everyone. An IPv6 caller is also counted by its /48, with a looser limit.
     * A request for a blocked domain (`target` undefined) counts against the caller only: it fetches nothing, but it is logged and recorded.
     */
    const enforceLimits = async (client: string, target: { domain: string; url: string | undefined } | undefined): Promise<ScanSnapshot | undefined> => {
        const { perIp, perDomain, windowMs } = deps.limits;
        const callerLimits = callerLimitsOf(client, 'ip', perIp);
        const domainKey = target === undefined ? undefined : `domain:${target.domain}`;
        let decision = await deps.limiter.hit([...callerLimits, ...(domainKey === undefined ? [] : [{ key: domainKey, limit: perDomain }])], windowMs);
        if (decision.allowed) return undefined;
        if (decision.key === domainKey && target?.url !== undefined) {
            const recent = await store.findRecent(target.url, new Date(clock.now().getTime() - windowMs));
            if (recent !== undefined) {
                decision = await deps.limiter.hit(callerLimits, windowMs);
                if (decision.allowed) {
                    deps.logger.info({ publicId: recent.publicId, domain: target.domain, ...clientField(client) }, 'recent scan reused');
                    return shown(recent);
                }
            }
        }
        const byCaller = decision.key !== domainKey;
        const message = byCaller ? 'Too many scans from your address. Try again later.' : 'This site was scanned many times recently. Try again later.';
        deps.logger.warn({ reason: 'rate_limited', limit: byCaller ? 'caller' : 'domain', domain: target?.domain, retryAfterSec: decision.retryAfterSec, ...clientField(client) }, 'scan refused');
        throw new AppError('RATE_LIMITED', message, undefined, decision.retryAfterSec);
    };

    /**
     * `client` is who asked (an address); a scan started inside the process, with no caller, passes none and is not limited.
     * The same address scanned in the last `reuseMs` (still running or completed) is handed out again and spends no limit,
     * unless `fresh` asks for a new scan, which is limited as usual.
     */
    const create = async (input: string, client?: string, fresh = false, checks?: readonly string[]): Promise<ScanSnapshot> => {
        const normalized = normalizeUrl(input);
        if (!normalized.ok) {
            // The input itself is not logged: it is whatever a stranger typed.
            deps.logger.info({ reason: 'invalid_url', rejection: normalized.reason, length: input.length, ...clientField(client) }, 'scan refused');
            throw new AppError('VALIDATION_FAILED', REJECTION_MESSAGE[normalized.reason], [{ path: 'url', message: normalized.reason }]);
        }

        // A choice of checks: unknown ids are refused, the ones that must always run are added, and a choice that covers everything is a plain full scan.
        const choice = checks === undefined ? { ids: undefined, unknown: [] } : normalizeSelection(checks);
        if (choice.unknown.length > 0) {
            deps.logger.info({ reason: 'invalid_checks', count: choice.unknown.length, ...clientField(client) }, 'scan refused');
            throw new AppError('VALIDATION_FAILED', 'Some of the chosen checks do not exist.', [{ path: 'checks', message: 'UNKNOWN_CHECK' }]);
        }
        const selectedChecks = choice.ids;
        const checkCount = checksFor(selectedChecks).length;
        // A scan with a choice of checks is its own: it is never handed out in place of a full one, and a full scan is not answered with it.
        const customized = selectedChecks !== undefined;

        const { host } = normalized.url;
        const rule = blockedBy(host);
        if (rule !== undefined) {
            if (client !== undefined) await enforceLimits(client, undefined);
            deps.logger.warn({ reason: 'domain_blocked', domain: host, rule, ...clientField(client) }, 'scan refused');
            // Recorded under the rule, not the host: made-up subdomains (`<random>.x.ru`) would otherwise each add a row that is kept for good.
            await remember(rule, 'blocked');
            throw new AppError('DOMAIN_BLOCKED', 'Scanning this domain is not available.');
        }

        // What is stored is public (the report): the query keeps its keys only. The job carries the address as typed.
        const shownUrl = hideQueryValues(normalized.url.href);
        const domain = registrableDomain(host);
        // A URL with hidden query values cannot be matched safely: `?id=1` and `?id=2` look the same once stored.
        const reusableUrl = shownUrl === normalized.url.href ? shownUrl : undefined;
        const reuseMs = deps.reuseMs ?? 0;
        if (!fresh && !customized && reuseMs > 0 && reusableUrl !== undefined) {
            // Free of the scan limit, but not unlimited: a bucket of its own, far looser, so a loop of requests cannot hammer the database.
            if (client !== undefined) {
                const decision = await deps.limiter.hit(callerLimitsOf(client, 'reuse', deps.limits.perIp * REUSE_FACTOR), deps.limits.windowMs);
                if (!decision.allowed) {
                    deps.logger.warn({ reason: 'rate_limited', limit: 'reuse', domain, retryAfterSec: decision.retryAfterSec, ...clientField(client) }, 'scan refused');
                    throw new AppError('RATE_LIMITED', 'Too many scans from your address. Try again later.', undefined, decision.retryAfterSec);
                }
            }
            const recent = await store.findRecent(reusableUrl, new Date(clock.now().getTime() - reuseMs));
            if (recent !== undefined) {
                deps.logger.info({ publicId: recent.publicId, domain, status: recent.status, ...clientField(client) }, 'recent scan reused');
                // Not awaited: a popular address must not make every request wait on one row of the list.
                void remember(domain, 'reused');
                return shown(recent);
            }
        }
        if (client !== undefined) {
            // A fresh scan asked for is never answered with an older one, not even when the domain is busy.
            const reused = await enforceLimits(client, { domain, url: fresh || customized ? undefined : reusableUrl }).catch(async (error: unknown) => {
                if (error instanceof AppError && error.code === 'RATE_LIMITED') await remember(domain, 'limited');
                throw error;
            });
            if (reused !== undefined) {
                void remember(domain, 'reused');
                return reused;
            }
        }
        // The registrable domain, not the host: made-up subdomains (`<random>.x.com`) would otherwise each add a row that is kept for good.
        await remember(domain, 'scan');

        const publicId = ids.next();
        await store.create(emptySnapshot({ publicId, url: shownUrl, domain: host, createdAt: now(), totalChecks: checkCount, ...(selectedChecks === undefined ? {} : { selectedChecks }) }));
        const snapshot = await publish(publicId, { type: 'scan.started', ts: now(), data: { url: shownUrl, domain: host, totalChecks: checkCount } });
        // Typed without a scheme: the worker may fall back to http when https does not answer at all.
        const httpFallback = !/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim());
        try {
            await queue.enqueue({ publicId, url: normalized.url.href, ...(httpFallback ? { httpFallback } : {}) });
        } catch (error) {
            // No queue (Redis away): the scan would never run, so it ends now instead of waiting for the reaper.
            deps.logger.error({ err: error, publicId }, 'queueing a scan failed');
            await publish(publicId, { type: 'scan.failed', ts: now(), data: { reason: 'internal_error' } }).catch(() => undefined);
            throw new AppError('INTERNAL', 'The scan could not be started. Try again later.');
        }
        // The address is logged as host and path length only: a path or a query can carry a token. The full address is in the database for as long as the report.
        deps.logger.info({ publicId, ...urlForLog(normalized.url.href), hasQuery: normalized.url.path.includes('?'), totalChecks: checkCount, customized, ...clientField(client) }, 'scan created');
        return shown(snapshot);
    };

    const get = async (publicId: string): Promise<ScanSnapshot> => {
        const snapshot = await store.get(publicId);
        if (snapshot === undefined) throw new AppError('NOT_FOUND', 'No such scan.');
        return shown(snapshot);
    };

    /**
     * `create` behind an `Idempotency-Key`: the same key from the same caller for the same input within `IDEMPOTENCY_MS` gets the scan the
     * first request started, in its current state, and spends no rate limit (a double submit, a retried request). A request that was
     * refused or failed leaves no entry, so it can be retried with the same key. The input counts as its normalized address (`Example.com`
     * and `https://example.com/` are one request), and at most `IDEMPOTENCY_MAX_KEYS` keys are kept, the oldest forgotten first.
     * shortcut: the keys live in this process (the rate limits are shared through Redis, these are not), so a repeat that reaches another
     * API process starts a second scan; move them to Redis when the API runs more than once.
     */
    const createOnce = async (input: string, client?: string, idempotencyKey?: string, fresh = false, checks?: readonly string[]): Promise<ScanSnapshot> => {
        if (idempotencyKey === undefined) return create(input, client, fresh, checks);
        const at = clock.now().getTime();
        // In insertion order, so the expired ones are at the front.
        for (const [key, entry] of recentRequests) {
            if (at - entry.at < IDEMPOTENCY_MS) break;
            recentRequests.delete(key);
        }
        const normalized = normalizeUrl(input);
        // An address that cannot be scanned is refused by `create`, and leaves no entry.
        if (!normalized.ok) return create(input, client, fresh, checks);
        const key = JSON.stringify([client ?? null, idempotencyKey, normalized.url.href, fresh, checks ?? null]);
        const known = recentRequests.get(key);
        if (known !== undefined) {
            const { publicId } = await known.scan;
            deps.logger.info({ publicId, ...clientField(client) }, 'scan request repeated, same scan returned');
            return get(publicId);
        }
        const scan = create(input, client, fresh, checks);
        recentRequests.set(key, { at, scan });
        for (const oldest of recentRequests.keys()) {
            if (recentRequests.size <= IDEMPOTENCY_MAX_KEYS) break;
            recentRequests.delete(oldest);
        }
        scan.catch(() => {
            if (recentRequests.get(key)?.scan === scan) recentRequests.delete(key);
        });
        return scan;
    };

    /** The caller has already looked the scan up (`get`): an unknown id is its 404. A scan deleted meanwhile gives an empty stream. */
    const follow = (publicId: string, lastEventId: string | undefined, signal: AbortSignal): AsyncIterable<ScanEvent> => store.follow(publicId, lastEventId, signal);

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
     * The certificate a visitor is shown: of the host the page ended on when it is served over https (on the usual port), else of the
     * host as typed. The page was fetched there through the safe fetcher, and the certificate is read through the same guarded lookup.
     */
    const certificateHostOf = (fetched: SiteFetchResult, typedHost: string): string => {
        if (!fetched.ok) return typedHost;
        const final = new URL(fetched.page.finalUrl);
        return final.protocol === 'https:' && final.port === '' ? final.hostname : typedHost;
    };

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
            let snapshot = await get(publicId);
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

            // The contact with the scanned site: the page and the plain-http entry point in parallel; once the page is in, the certificate and
            // the small files around it (robots.txt, the sitemap, a missing page, the other host name), on the site the page ended on. All go through the safe fetcher.
            // An address typed without a scheme was tried as https; a site that does not answer https at all (no connection, a failed handshake)
            // gets one try over http, and is scanned there when that answers.
            const pageFetch = deps.fetcher.fetchPage(typed.url.href, { signal }).then(async (result) => {
                if (result.ok || httpFallback !== true || typed.url.scheme !== 'https' || (result.reason !== 'unreachable' && result.reason !== 'tls_error')) return { result, url: typed.url };
                const plain = normalizeUrl(typed.url.href.replace(/^https:/, 'http:'));
                const retried = plain.ok ? await deps.fetcher.fetchPage(plain.url.href, { signal }) : result;
                return retried.ok && plain.ok ? { result: retried, url: plain.url } : { result, url: typed.url };
            });
            const [{ result: fetched, url }, probe, certificate, siteProbes] = await Promise.all([
                pageFetch,
                deps.fetcher.fetchPage(`http://${typed.url.host}/`, { signal }),
                pageFetch.then(({ result }) => deps.fetcher.inspectCertificate(certificateHostOf(result, typed.url.host))),
                pageFetch.then(({ result, url: site }) => probeSite(deps.fetcher, site, { ...(result.ok ? { finalUrl: result.page.finalUrl, page: result.page } : {}), signal })),
            ]);
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
                    httpEntry: probe.ok ? { status: probe.page.status, finalScheme: probe.page.finalUrl.startsWith('https:') ? 'https' : 'http' } : { failure: probe.reason },
                    certificate: certificate === null ? null : { authorized: certificate.authorized, error: certificate.error, daysLeft: certificate.daysLeft },
                    files: {
                        robots: status(siteProbes.robots),
                        sitemap: status(siteProbes.sitemap),
                        sitemapSampled: siteProbes.sitemapSample.length,
                        assetsSampled: siteProbes.assetSample.length,
                        llms: status(siteProbes.llms),
                        agentFiles: Object.values(siteProbes.agentFiles).filter((file) => file !== null).length,
                        markdown: siteProbes.markdown === null ? null : { status: siteProbes.markdown.status, contentType: siteProbes.markdown.contentType },
                        notFound: status(siteProbes.notFound),
                        otherHost: siteProbes.hostVariant === undefined ? 'none' : status(siteProbes.hostVariant),
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
            const page = fetched.ok ? fetched.page : undefined;
            const httpProbe = probe.ok ? { finalUrl: probe.page.finalUrl, status: probe.page.status } : null;

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
                const result = await runCheck(check, { url, ...(page === undefined ? {} : { page }), certificate, httpProbe, ...siteProbes });
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
                if (await queue.isPending(publicId)) continue;
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

    return { create: createOnce, get, follow, run, reapStuck, failLost };
};

export type ScansService = ReturnType<typeof createScansService>;
