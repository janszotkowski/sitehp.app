import { checksFor, normalizeSelection, emptySnapshot, hideQueryValues, normalizeUrl, type ScanEvent, type ScanSnapshot, type UrlRejection } from '@sitehp.app/core';
import { AppError } from '@platform/errors.ts';
import { urlForLog, type Logger } from '@platform/logger.ts';
import type { Clock, IdGenerator } from '@platform/ports.ts';
import type { RateLimiter } from '@platform/rate-limit.ts';
import { callerLimits } from '@platform/net/ip.ts';
import { registrableDomain } from '@platform/net/registrable-domain.ts';
import { publisherOf, shown } from '@modules/scans/application/publish.ts';
import type { JobQueue, ScanStore, SiteLog, SiteRequestOutcome } from '@modules/scans/ports.ts';

export type ScansDeps = {
    store: ScanStore;
    /** The permanent list of scanned domains. */
    siteLog: SiteLog;
    /** The block-list rule a host falls under (`*.ru`, `evil.example`), or undefined when it may be scanned. */
    blockedBy: (host: string) => string | undefined;
    queue: JobQueue;
    ids: IdGenerator;
    clock: Clock;
    logger: Logger;
    /** Put the caller's address in the log lines (`LOG_CLIENT_IP`). */
    logClient: boolean;
    limiter: RateLimiter;
    limits: { perIp: number; perDomain: number; windowMs: number };
    /** A scan of the same address started this recently is handed out again (`SCAN_REUSE_MS`); 0 turns it off. */
    reuseMs?: number;
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

/** Recent scans one caller may be handed per window, as a multiple of the scans it may start: a reuse fetches nothing, but it is still a database read. */
const REUSE_FACTOR = 10;

/** How long an `Idempotency-Key` stands for the scan it started. */
const IDEMPOTENCY_MS = 10 * 60_000;

/** `Idempotency-Key`s remembered at most; past it the oldest is forgotten, so new keys cannot fill the memory. */
const IDEMPOTENCY_MAX_KEYS = 10_000;

/**
 * Starting a scan and reading it: validation, the block list, the rate limits, reuse of a recent report and idempotency, then the job
 * on the queue. Running it is `createScanRunner`. Everything it touches is a port, so it runs in tests against in-memory adapters.
 */
export const createScansService = (deps: ScansDeps) => {
    const { store, queue, ids, clock, blockedBy } = deps;
    /** Requests with an `Idempotency-Key`, oldest first: what `createOnce` answers a repeat with. */
    const recentRequests = new Map<string, { at: number; scan: Promise<ScanSnapshot> }>();

    const publish = publisherOf(store, deps.logger);

    const now = () => clock.now().toISOString();

    /** The caller's address, only when the settings allow it in a log. */
    const clientField = (client: string | undefined): { client?: string } => (deps.logClient && client !== undefined ? { client } : {});

    /** The list of domains is for the owner's overview: a failure to write to it is logged and never stops a scan. */
    const remember = (domain: string, outcome: SiteRequestOutcome): Promise<void> =>
        deps.siteLog.recordRequest(domain, clock.now(), outcome).catch((error: unknown) => deps.logger.warn({ err: error, domain }, 'recording a requested domain failed'));

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
        const callerBuckets = callerLimits(client, perIp, 'ip');
        const domainKey = target === undefined ? undefined : `domain:${target.domain}`;
        let decision = await deps.limiter.hit([...callerBuckets, ...(domainKey === undefined ? [] : [{ key: domainKey, limit: perDomain }])], windowMs);
        if (decision.allowed) return undefined;
        if (decision.key === domainKey && target?.url !== undefined) {
            const recent = await store.findRecent(target.url, new Date(clock.now().getTime() - windowMs));
            if (recent !== undefined) {
                decision = await deps.limiter.hit(callerBuckets, windowMs);
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
                const decision = await deps.limiter.hit(callerLimits(client, deps.limits.perIp * REUSE_FACTOR, 'reuse'), deps.limits.windowMs);
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

    return { create: createOnce, get, follow };
};

export type ScansService = ReturnType<typeof createScansService>;
