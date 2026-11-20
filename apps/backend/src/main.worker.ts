import { buildContainer } from '@composition/deps.ts';
import { startReaper, stuckAfterMs } from '@composition/reaper.ts';
import { loadConfig } from '@config/env.ts';
import { startHeartbeat } from '@platform/heartbeat.ts';
import { createLogger } from '@platform/logger.ts';
import { systemClock } from '@platform/ports.ts';
import { connectDatabase } from '@modules/scans/infrastructure/postgres/connect.ts';
import { createBullJobQueue, createScanWorker } from '@modules/scans/infrastructure/redis/bull-queue.ts';
import { connectRedis } from '@modules/scans/infrastructure/redis/redis.ts';
import { createRedisScanSignal } from '@modules/scans/infrastructure/redis/scan-signal.ts';

/**
 * The worker process: takes scans off the queue and runs them, with no HTTP of its own. It reads and writes the same database as the API,
 * and tells the API's live streams through Redis. Run as many as the load needs; each takes `SCAN_MAX_CONCURRENT` scans at once.
 */
const fail = (message: string): never => {
    process.stderr.write(`${message}\n`);
    return process.exit(1);
};

const loaded = loadConfig();
if (!loaded.ok) fail(`Invalid configuration:\n${loaded.problems.map((problem) => `  - ${problem}`).join('\n')}`);
const config = loaded.ok ? loaded.config : fail('unreachable');
if (config.REDIS_URL === undefined || config.DATABASE_URL === undefined) fail('The worker needs REDIS_URL (the queue) and DATABASE_URL (the scans it writes).');

const logger = createLogger(config, 'worker');
// A promise nobody handled or a throw nobody caught leaves the process in a state nothing planned for: logged, then the process ends and is restarted.
process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    process.exit(1);
});
process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
});
const database = await connectDatabase(config.DATABASE_URL ?? '').catch((error: unknown) =>
    fail(`Cannot open the database: ${error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)}`),
);
// Two connections: the worker blocks on its own (it waits through a Redis restart); the queue and the signal fail fast instead of hanging.
const redis = connectRedis(config.REDIS_URL ?? '', logger);
const blocking = connectRedis(config.REDIS_URL ?? '', logger, { blocking: true });
const wake = createRedisScanSignal(redis, logger);
// The worker builds the same service as the API and never serves a request. Its queue never enqueues: the reaper asks it whether a job still exists.
const queue = createBullJobQueue(redis);
const container = buildContainer(config, { logger, database, queue, signal: wake });

logger.info(
    {
        nodeEnv: config.NODE_ENV,
        version: config.APP_VERSION,
        logLevel: config.LOG_LEVEL,
        concurrency: config.SCAN_MAX_CONCURRENT,
        stuckAfterMs: stuckAfterMs(config),
        fetch: { timeoutMs: config.FETCH_TIMEOUT_MS, maxBytes: config.FETCH_MAX_BYTES, maxRedirects: config.FETCH_MAX_REDIRECTS },
        blockedTlds: config.BLOCKED_TLDS,
        replayDemoSites: config.SITE_FETCHER_REPLAY_DIR !== undefined,
    },
    'worker configuration',
);

const worker = createScanWorker(blocking, (job) => container.scans.run(job), {
    concurrency: config.SCAN_MAX_CONCURRENT,
    logger,
    onFailed: (job) => container.scans.failLost(job.publicId),
});

// A scan whose job was lost is failed instead of left to wait for ever. Other workers may be running scans: only old ones are judged.
const stopReaper = startReaper(container.scans, logger, stuckAfterMs(config));
// No HTTP to probe: the container's health check reads the age of this file.
const stopHeartbeat = startHeartbeat(config.WORKER_HEARTBEAT_FILE, systemClock, logger);
logger.info({ heartbeatFile: config.WORKER_HEARTBEAT_FILE }, 'worker ready');

// The queue length as a log line once a minute: the one metric no scan's own log carries. Every worker logs the same shared numbers.
const queueTimer = setInterval(() => {
    queue
        .counts()
        .then((counts) => logger.info({ queue: counts }, 'queue length'))
        .catch((error: unknown) => logger.warn({ err: error }, 'reading the queue length failed'));
}, 60_000);
queueTimer.unref();

let stopping = false;
const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'worker shutting down: finishing the scans in progress');
    // A scan takes well under a minute; a worker that cannot finish by then is cut.
    const force = setTimeout(() => {
        logger.error('worker shutdown timed out');
        process.exit(1);
    }, 60_000);
    force.unref();
    stopReaper();
    stopHeartbeat();
    clearInterval(queueTimer);
    void worker
        .close()
        .then(() => container.close())
        .then(() => queue.close())
        .then(() => wake.close())
        .then(() => Promise.all([redis.quit(), blocking.quit()]))
        .catch((error: unknown) => logger.error({ err: error }, 'closing the worker failed'))
        .finally(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
