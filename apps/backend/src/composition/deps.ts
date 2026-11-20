import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Config } from '@config/env.ts';
import type { ReadinessProbe } from '@modules/health/ports.ts';
import { createReplayFetcher, loadDemoSites } from '@modules/scans/infrastructure/replay-fetcher.ts';
import { createSiteFetcher } from '@modules/scans/infrastructure/site-fetcher.ts';
import type { JobQueue, ScanSignal, SiteFetcher } from '@modules/scans/ports.ts';
import { createInlineJobQueue, createInMemoryScanStore, createInMemorySiteLog } from '@modules/scans/infrastructure/in-memory.ts';
import type { Database } from '@modules/scans/infrastructure/postgres/connect.ts';
import { createPostgresScanStore, createPostgresSiteLog } from '@modules/scans/infrastructure/postgres/stores.ts';
import { createScanRunner, type ScanRunner } from '@modules/scans/application/scan-runner.ts';
import { createScansService, type ScansService } from '@modules/scans/application/scans-service.ts';
import type { AppDeps } from '@platform/http/types.ts';
import { blockedBy } from '@platform/net/blocked-hosts.ts';
import { secureIdGenerator } from '@platform/ids.ts';
import { createRateLimiter, createRedisRateLimiter } from '@platform/rate-limit.ts';
import { createLogger, type Logger } from '@platform/logger.ts';
import { systemClock, type Clock, type IdGenerator } from '@platform/ports.ts';

export type Container = {
    deps: AppDeps;
    scans: ScansService;
    /** Runs the scans: a worker takes its jobs, the API runs them itself when it has no queue. */
    runner: ScanRunner;
    /** What `GET /v1/ready` asks: the database and Redis, when this process uses them. */
    probes: ReadinessProbe[];
    /** Ends every open stream (clients resume elsewhere with Last-Event-ID), so the server can stop without waiting on them. */
    endStreams: () => void;
    /** Ends the streams, stops the purge and releases outgoing connections and the database. Called after the server has stopped. */
    close: () => Promise<void>;
};

export type ContainerOverrides = {
    clock?: Clock;
    ids?: IdGenerator;
    /** Tests pass a fake that never opens a socket. */
    fetcher?: SiteFetcher;
    /** An open database: scans and the list of domains live in it. Without one they live in memory. */
    database?: Database;
    /** The queue scans are handed to. Without one the API runs them itself, in this process. */
    queue?: JobQueue;
    /** Wakes a live stream when a worker in another process publishes. */
    signal?: ScanSignal;
    /** With it the rate limits are shared by every API process, and readiness asks it too. */
    redis?: Pick<Redis, 'eval' | 'ping'>;
    /** Tests capture what is logged. */
    logger?: Logger;
    /** Delete expired reports every hour (default). One kind of process does it: the worker, or the API when it runs scans itself. */
    purge?: boolean;
};

/** How often reports older than the retention are deleted from the database. */
const PURGE_EVERY_MS = 3_600_000;

/** How often a live stream looks in the database for new events. With a signal from other processes the look is only the fallback for a missed one. */
export const streamPollMs = (signal: ScanSignal | undefined): number => (signal === undefined ? 1000 : 15_000);

/**
 * Wires the adapters. Scans are stored in PostgreSQL when a database is given and in memory otherwise;
 * Redis and BullMQ replace the queue here and nowhere else.
 */
export const buildContainer = (config: Config, overrides: ContainerOverrides = {}): Container => {
    const clock = overrides.clock ?? systemClock;
    const logger = overrides.logger ?? createLogger(config);
    const stopping = new AbortController();
    const deps: AppDeps = { config, logger, clock, startedAt: clock.now(), stopping: stopping.signal };
    const replayDir = config.SITE_FETCHER_REPLAY_DIR;
    const fetcher = overrides.fetcher ?? (replayDir === undefined ? createSiteFetcher(config, clock, logger) : createReplayFetcher(loadDemoSites(replayDir)));

    const { database, redis } = overrides;
    const store =
        database === undefined
            ? createInMemoryScanStore({ clock, ttlMs: config.SCAN_RETENTION_MS, maxScans: config.SCAN_MAX_STORED })
            : createPostgresScanStore(database.db, streamPollMs(overrides.signal), overrides.signal);
    const siteLog = database === undefined ? createInMemorySiteLog() : createPostgresSiteLog(database.db);
    const rules = { tlds: config.BLOCKED_TLDS, domains: config.BLOCKED_DOMAINS };

    // The runner asks the queue whether a job still exists; the in-process queue runs its jobs on the runner. Both are looked up only when called.
    const runner = createScanRunner({
        store,
        siteLog,
        fetcher,
        isPending: (publicId) => queue.isPending(publicId),
        clock,
        logger,
        stepDelayMs: config.SCAN_STEP_DELAY_MS,
        deadlineMs: config.SCAN_DEADLINE_MS,
    });
    const queue =
        overrides.queue ??
        createInlineJobQueue(
            (job) => runner.run(job),
            (error) => logger.error({ err: error }, 'scan job failed'),
            config.SCAN_MAX_CONCURRENT,
        );
    const scans = createScansService({
        store,
        siteLog,
        blockedBy: (host) => blockedBy(host, rules),
        queue,
        ids: overrides.ids ?? secureIdGenerator,
        clock,
        logger,
        logClient: config.LOG_CLIENT_IP,
        limiter: redis === undefined ? createRateLimiter(clock) : createRedisRateLimiter(redis),
        limits: { perIp: config.SCAN_LIMIT_PER_IP, perDomain: config.SCAN_LIMIT_PER_DOMAIN, windowMs: config.SCAN_LIMIT_WINDOW_MS },
        reuseMs: config.SCAN_REUSE_MS,
    });

    // Retention: a report and its log are deleted once they are older than SCAN_RETENTION_MS (the in-memory store sweeps itself).
    const purge = (): void => {
        store
            .deleteOlderThan(new Date(clock.now().getTime() - config.SCAN_RETENTION_MS))
            .then((removed) =>
                removed > 0 ? logger.info({ removed, retentionDays: Math.round(config.SCAN_RETENTION_MS / 86_400_000) }, 'deleted expired scans') : logger.debug('no expired scans to delete'),
            )
            .catch((error: unknown) => logger.error({ err: error }, 'deleting expired scans failed'));
    };
    const purges = database !== undefined && (overrides.purge ?? true);
    const purging = purges ? setInterval(purge, PURGE_EVERY_MS) : undefined;
    purging?.unref();
    if (purges) purge();

    const endStreams = (): void => stopping.abort();
    const close = async (): Promise<void> => {
        clearInterval(purging);
        endStreams();
        await fetcher.close();
        await database?.close();
    };

    const probes: ReadinessProbe[] = [
        ...(database === undefined ? [] : [{ name: 'database', check: () => database.db.execute(sql`select 1`) }]),
        ...(redis === undefined ? [] : [{ name: 'redis', check: () => redis.ping() }]),
    ];

    return { deps, scans, runner, probes, endStreams, close };
};
