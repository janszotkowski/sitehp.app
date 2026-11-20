import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '@composition/app.ts';
import { buildContainer } from '@composition/deps.ts';
import { createBullJobQueue, createScanWorker } from '@modules/scans/infrastructure/redis/bull-queue.ts';
import { createRedisScanSignal } from '@modules/scans/infrastructure/redis/scan-signal.ts';
import type { Database } from '@modules/scans/infrastructure/postgres/connect.ts';
import { createLogger } from '@platform/logger.ts';
import { createRedisRateLimiter } from '@platform/rate-limit.ts';
import { fakeFetcher, FIXED_TIME, sequentialIds, testConfig, testDatabase } from '@tests/helpers.ts';

/**
 * BullMQ and the wake-up channel against a real Redis (`docker compose up -d`, then REDIS_URL=redis://:sitehp@localhost:6379).
 * Without REDIS_URL these are skipped locally; CI starts a Redis service and sets it, and a CI run without it fails instead of skipping.
 */
const url = process.env['REDIS_URL'];
if (process.env['CI'] && url === undefined) throw new Error('REDIS_URL is not set: CI must run the Redis tests, not skip them');
const silent = createLogger({ LOG_LEVEL: 'silent' });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000) => {
    const start = Date.now();
    while (!(await condition())) {
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await wait(20);
    }
};

// Real Redis and Postgres on a shared CI runner: a whole scan takes about 3.5 s there, too close to the 5 s default, and `until` waits up to 10 s.
describe.skipIf(url === undefined)('BullMQ and Redis', { timeout: 30_000 }, () => {
    const prefix = `test-${randomUUID()}`;
    const connections: Redis[] = [];
    const connect = () => {
        const redis = new Redis(url ?? '', { maxRetriesPerRequest: null });
        connections.push(redis);
        return redis;
    };
    const closers: Array<() => Promise<unknown>> = [];

    afterAll(async () => {
        await Promise.all(closers.map((close) => close().catch(() => undefined)));
        // Leave nothing behind in a shared Redis.
        const cleaner = connect();
        const keys = await cleaner.keys(`${prefix}:*`);
        if (keys.length > 0) await cleaner.del(...keys);
        await Promise.all(connections.map((redis) => redis.quit().catch(() => undefined)));
    });

    it('hands a queued scan to a worker, once, even when it is queued twice', async () => {
        const queue = createBullJobQueue(connect(), { prefix });
        closers.push(queue.close);
        const seen: string[] = [];
        const worker = createScanWorker(
            connect(),
            (job) => {
                seen.push(job.publicId);
                return Promise.resolve();
            },
            { prefix, concurrency: 2, logger: silent },
        );
        closers.push(worker.close);

        await queue.enqueue({ publicId: 'scan-aaaaaaaaaaaaaaaaaa' });
        await queue.enqueue({ publicId: 'scan-aaaaaaaaaaaaaaaaaa' });
        await queue.enqueue({ publicId: 'scan-bbbbbbbbbbbbbbbbbb' });
        await until(() => seen.length >= 2, 'both scans to run');
        // Both jobs have ended: the second `enqueue` of the same id added none, so nothing more can run.
        await until(async () => !(await queue.isPending('scan-aaaaaaaaaaaaaaaaaa')) && !(await queue.isPending('scan-bbbbbbbbbbbbbbbbbb')), 'both jobs to end');
        expect(seen.sort()).toEqual(['scan-aaaaaaaaaaaaaaaaaa', 'scan-bbbbbbbbbbbbbbbbbb']);
    });

    it('tells the reaper whether a job still waits or runs: yes while queued, no once it ended or when there is none', async () => {
        const name = `${prefix}-pending`;
        const queue = createBullJobQueue(connect(), { prefix: name });
        closers.push(queue.close);
        await queue.enqueue({ publicId: 'scan-eeeeeeeeeeeeeeeeee' });
        expect(await queue.isPending('scan-eeeeeeeeeeeeeeeeee')).toBe(true);
        expect(await queue.isPending('scan-never-queued-0000')).toBe(false);
        const worker = createScanWorker(connect(), () => Promise.resolve(), { prefix: name, concurrency: 1, logger: silent });
        closers.push(worker.close);
        await until(async () => !(await queue.isPending('scan-eeeeeeeeeeeeeeeeee')), 'the job to end');
    });

    it('runs no more scans at once than its concurrency', async () => {
        const name = `${prefix}-concurrency`;
        const queue = createBullJobQueue(connect(), { prefix: name });
        closers.push(queue.close);
        let running = 0;
        let peak = 0;
        let done = 0;
        const worker = createScanWorker(
            connect(),
            async () => {
                running += 1;
                peak = Math.max(peak, running);
                // Each scan stays until a second one runs beside it (or none is left to), so a third at once would show in `peak`.
                await until(() => running >= 2 || done + running === 6, 'a second scan beside this one');
                running -= 1;
                done += 1;
            },
            { prefix: name, concurrency: 2, logger: silent },
        );
        closers.push(worker.close);
        for (let n = 0; n < 6; n += 1) await queue.enqueue({ publicId: `scan-${String(n).padStart(18, '0')}` });
        await until(() => done === 6, 'six scans to finish');
        expect(peak).toBe(2);
    });

    it('lets a scan in progress finish when the worker is closed', async () => {
        const name = `${prefix}-close`;
        const queue = createBullJobQueue(connect(), { prefix: name });
        closers.push(queue.close);
        let started = false;
        let closing = false;
        let finished = false;
        const worker = createScanWorker(
            connect(),
            async () => {
                started = true;
                // Still running when the worker is told to close.
                await until(() => closing, 'the worker to be closed');
                finished = true;
            },
            { prefix: name, concurrency: 1, logger: silent },
        );
        await queue.enqueue({ publicId: 'scan-cccccccccccccccccc' });
        await until(() => started, 'the scan to start');
        closing = true;
        await worker.close();
        expect(finished).toBe(true);
    });

    it('fails the scan of a job that failed, through the handler it is given', async () => {
        const name = `${prefix}-failed`;
        const queue = createBullJobQueue(connect(), { prefix: name });
        closers.push(queue.close);
        const failed: string[] = [];
        const worker = createScanWorker(connect(), () => Promise.reject(new Error('the run threw')), {
            prefix: name,
            concurrency: 1,
            logger: silent,
            onFailed: (job) => (failed.push(job.publicId), Promise.resolve()),
        });
        closers.push(worker.close);
        await queue.enqueue({ publicId: 'scan-ffffffffffffffffff' });
        await until(() => failed.length > 0, 'the failed handler');
        expect(failed).toEqual(['scan-ffffffffffffffffff']);
    });

    it('wakes a subscriber of a scan, and no one after it unsubscribes', async () => {
        const publisher = connect();
        const signal = createRedisScanSignal(publisher, silent);
        closers.push(signal.close);
        let woken = 0;
        let marks = 0;
        // Messages arrive in the order they were published: once a mark sent after a signal arrives, that signal has arrived too (or never will).
        signal.subscribe('scan-mark', () => (marks += 1));
        const unsubscribe = signal.subscribe('scan-dddddddddddddddddd', () => (woken += 1));
        // The subscription is made in the background: signal until it is in place.
        await until(async () => {
            await signal.notify('scan-dddddddddddddddddd');
            return woken >= 1;
        }, 'the signal');
        const flush = async () => {
            const before = marks;
            await signal.notify('scan-mark');
            await until(() => marks > before, 'the mark');
        };
        await flush();
        const afterSubscribe = woken;
        await signal.notify('scan-other');
        await flush();
        expect(woken).toBe(afterSubscribe);
        unsubscribe();
        await signal.notify('scan-dddddddddddddddddd');
        await flush();
        expect(woken).toBe(afterSubscribe);
    });

    it('runs a whole scan the way production does: the API queues it, a worker in another process-like container runs it, the stream follows', async () => {
        const name = `${prefix}-stack`;
        const database: Database = await testDatabase();
        closers.push(database.close);
        const apiRedis = connect();
        const queue = createBullJobQueue(apiRedis, { prefix: name });
        const apiSignal = createRedisScanSignal(apiRedis, silent);
        closers.push(queue.close, apiSignal.close);
        const api = buildContainer(testConfig(), { clock: { now: () => FIXED_TIME }, ids: sequentialIds(), fetcher: fakeFetcher(), database, queue, signal: apiSignal });

        // The worker has its own container and its own connections, and shares only the database and Redis with the API.
        const workerRedis = connect();
        const workerSignal = createRedisScanSignal(workerRedis, silent);
        closers.push(workerSignal.close);
        const workerSide = buildContainer(testConfig(), { clock: { now: () => FIXED_TIME }, ids: sequentialIds(), fetcher: fakeFetcher(), database, signal: workerSignal });
        const worker = createScanWorker(workerRedis, (job) => workerSide.scans.run(job), { prefix: name, concurrency: 2, logger: silent });
        closers.push(worker.close);

        const app = createApp(api);
        const response = await app.request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'example.com' }) });
        expect(response.status).toBe(201);
        const { publicId } = (await response.json()) as { publicId: string };
        // Nothing has run in the API's own process: the scan was only queued.
        await until(async () => (await api.scans.get(publicId)).status === 'completed', 'the worker to finish the scan');

        const stream = await (await app.request(`/v1/scans/${publicId}/events`)).text();
        expect(stream).toContain('event: scan.completed');
        expect(await api.scans.get(publicId)).toMatchObject({ status: 'completed', score: 100 });
    });

    it('shares the rate limits in Redis: up to the limit, every key or none, and a new window once the old one ends', async () => {
        const limiter = createRedisRateLimiter(connect(), { prefix });
        const caller = { key: 'ip:203.0.113.1', limit: 2 };
        const domain = { key: 'domain:example.com', limit: 1 };

        expect(await limiter.hit([caller], 300)).toEqual({ allowed: true });
        expect(await limiter.hit([caller, domain], 300)).toEqual({ allowed: true });
        // Both are full now: the first full key is named, and nothing is counted.
        expect(await limiter.hit([domain, caller], 300)).toEqual({ allowed: false, key: 'domain:example.com', retryAfterSec: 1 });
        // A refusal by the domain does not use up another caller.
        const other = { key: 'ip:203.0.113.2', limit: 1 };
        expect(await limiter.hit([other, domain], 300)).toMatchObject({ allowed: false, key: 'domain:example.com' });
        expect(await limiter.hit([other], 300)).toEqual({ allowed: true });

        // A refused hit counts nothing, so asking until the window has ended changes nothing.
        await until(async () => (await limiter.hit([caller, domain], 300)).allowed, 'a new window');
    });

    it('counts a burst of parallel requests for one domain exactly: limit 10, 50 at once from 50 callers, 10 get through', async () => {
        const limiter = createRedisRateLimiter(connect(), { prefix: `${prefix}-burst` });
        const domain = { key: 'domain:burst.example', limit: 10 };
        const decisions = await Promise.all(Array.from({ length: 50 }, (_, i) => limiter.hit([{ key: `ip:198.51.100.${i}`, limit: 5 }, domain], 60_000)));
        expect(decisions.filter((decision) => decision.allowed)).toHaveLength(10);
    });

    it('reports the queue length: what waits for a worker', async () => {
        const queue = createBullJobQueue(connect(), { prefix: `${prefix}-counts` });
        closers.push(queue.close);
        await queue.enqueue({ publicId: 'scan-cccccccccccccccccc' });
        await queue.enqueue({ publicId: 'scan-dddddddddddddddddd' });
        expect(await queue.counts()).toMatchObject({ waiting: 2, active: 0 });
    });
});
