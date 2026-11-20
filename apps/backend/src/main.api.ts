import { serve } from '@hono/node-server';
import { buildContainer } from '@composition/deps.ts';
import { startReaper, stuckAfterMs } from '@composition/reaper.ts';
import { createApp } from '@composition/app.ts';
import { loadConfig } from '@config/env.ts';
import { createLogger } from '@platform/logger.ts';
import { createBullJobQueue } from '@modules/scans/infrastructure/redis/bull-queue.ts';
import { connectRedis } from '@modules/scans/infrastructure/redis/redis.ts';
import { createRedisScanSignal } from '@modules/scans/infrastructure/redis/scan-signal.ts';
import { connectDatabase } from '@modules/scans/infrastructure/postgres/connect.ts';

const loaded = loadConfig();
if (!loaded.ok) {
    process.stderr.write(`Invalid configuration:\n${loaded.problems.map((problem) => `  - ${problem}`).join('\n')}\n`);
    process.exit(1);
}

// The schema is brought up to date before the first request.
const databaseUrl = loaded.config.DATABASE_URL;
const database =
    databaseUrl === undefined
        ? undefined
        : await connectDatabase(databaseUrl).catch((error: unknown) => {
              process.stderr.write(`Cannot open the database: ${error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)}\n`);
              process.exit(1);
          });

// With Redis the API only queues a scan; a worker process (main.worker.ts) runs it. Without it the API runs scans itself.
const bootLogger = createLogger(loaded.config);
// A promise nobody handled or a throw nobody caught leaves the process in a state nothing planned for: logged, then the process ends and is restarted.
process.on('unhandledRejection', (reason) => {
    bootLogger.fatal({ err: reason }, 'unhandled rejection');
    process.exit(1);
});
process.on('uncaughtException', (error) => {
    bootLogger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
});
const redis = loaded.config.REDIS_URL === undefined ? undefined : connectRedis(loaded.config.REDIS_URL, bootLogger);
const queue = redis === undefined ? undefined : createBullJobQueue(redis);
const wake = redis === undefined ? undefined : createRedisScanSignal(redis, bootLogger);
const container = buildContainer(loaded.config, {
    logger: bootLogger,
    ...(database === undefined ? {} : { database }),
    ...(queue === undefined ? {} : { queue }),
    ...(wake === undefined ? {} : { signal: wake }),
    // The worker deletes expired reports; this process does only when it runs the scans itself.
    purge: queue === undefined,
    ...(redis === undefined ? {} : { redis }),
});
const { logger, config } = container.deps;

// The settings in force, with nothing secret in them: the first thing to read when a deployment behaves oddly.
logger.info(
    {
        nodeEnv: config.NODE_ENV,
        version: config.APP_VERSION,
        logLevel: config.LOG_LEVEL,
        logClientIp: config.LOG_CLIENT_IP,
        store: databaseUrl === undefined ? 'memory' : 'postgres',
        databaseHost: databaseUrl === undefined ? null : new URL(databaseUrl).host,
        retentionDays: Math.round(config.SCAN_RETENTION_MS / 86_400_000),
        blockedTlds: config.BLOCKED_TLDS,
        blockedDomains: config.BLOCKED_DOMAINS.length,
        limits: {
            perCaller: config.SCAN_LIMIT_PER_IP,
            perDomain: config.SCAN_LIMIT_PER_DOMAIN,
            windowMs: config.SCAN_LIMIT_WINDOW_MS,
            reuseMs: config.SCAN_REUSE_MS,
            maxConcurrent: config.SCAN_MAX_CONCURRENT,
            streamsPerCaller: config.SSE_MAX_STREAMS_PER_IP,
        },
        fetch: { timeoutMs: config.FETCH_TIMEOUT_MS, maxBytes: config.FETCH_MAX_BYTES, maxRedirects: config.FETCH_MAX_REDIRECTS },
        queue: redis === undefined ? 'in this process' : 'redis (a worker runs the scans)',
        trustedProxyHops: config.TRUSTED_PROXY_HOPS,
        replayDemoSites: config.SITE_FETCHER_REPLAY_DIR !== undefined,
    },
    'configuration',
);
if (database !== undefined) logger.info('database ready, migrations applied');

// Without Redis this process runs the scans itself (development), so a scan stored as `running` from before a restart can never finish:
// the first pass fails every one at once (none is in this fresh process's queue), later passes catch the rest like a worker's reaper.
const stopReaper = redis === undefined && database !== undefined ? startReaper(container.scans, logger, stuckAfterMs(config), 0) : undefined;

const server = serve({ fetch: createApp(container).fetch, port: config.PORT, hostname: config.HOST }, (address) => {
    logger.info({ port: address.port, host: config.HOST, version: config.APP_VERSION }, 'api listening');
});

let stopping = false;
const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    // Only a server that cannot finish in time is a failure.
    const force = setTimeout(() => {
        logger.error('shutdown timed out');
        process.exit(1);
    }, 10_000);
    force.unref();
    stopReaper?.();
    // Open SSE streams end first (clients resume with Last-Event-ID), so the server can stop: it takes no new connections, closes the
    // idle ones and calls back once the last request is answered. Only then go the database, the queue and Redis those requests use.
    container.endStreams();
    server.close(() => {
        void container
            .close()
            .then(() => queue?.close())
            .then(() => wake?.close())
            .then(() => redis?.quit())
            .catch((error: unknown) => logger.error({ err: error }, 'closing the container failed'))
            .finally(() => process.exit(0));
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
