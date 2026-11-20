import { CHECKS, emptySnapshot, reduceScan, SCORE_MODEL_VERSION } from '@sitehp.app/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { startReaper } from '@composition/reaper.ts';
import { scans } from '@modules/scans/infrastructure/postgres/schema.ts';
import { createPostgresScanStore } from '@modules/scans/infrastructure/postgres/stores.ts';
import { loadConfig } from '@config/env.ts';
import { buildContainer } from '@composition/deps.ts';
import type { JobQueue } from '@modules/scans/ports.ts';
import { captureLogs, fakeFetcher, FIXED_TIME, sequentialIds, testConfig, testContainer, testDatabase } from '@tests/helpers.ts';

const settled = async (container: ReturnType<typeof testContainer>, publicId: string) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
        if ((await container.scans.get(publicId)).status !== 'running') return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('the scan never finished');
};

/** A queue that keeps the job and never runs it: the scan stays `running`, as one whose worker was lost. */
const lostQueue = () => ({ enqueue: () => Promise.resolve(), isPending: () => Promise.resolve(false) });

describe('a scan whose job was lost', () => {
    const clock = { time: FIXED_TIME.getTime() };
    const containerWithLostJobs = (queue: JobQueue = lostQueue(), fetcher = fakeFetcher(), logger?: ReturnType<typeof captureLogs>['logger']) => {
        const loaded = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
        if (!loaded.ok) throw new Error('config');
        clock.time = FIXED_TIME.getTime();
        return buildContainer(loaded.config, { clock: { now: () => new Date(clock.time) }, ids: sequentialIds(), fetcher, queue, ...(logger === undefined ? {} : { logger }) });
    };

    it('is failed by the reaper once it is older than the limit, and a younger one is left to run', async () => {
        const container = containerWithLostJobs();
        const { publicId } = await container.scans.create('example.com');
        clock.time += 14 * 60_000;
        expect(await container.runner.reapStuck(900_000)).toBe(0);
        expect(await container.scans.get(publicId)).toMatchObject({ status: 'running' });

        clock.time += 2 * 60_000;
        expect(await container.runner.reapStuck(900_000)).toBe(1);
        expect(await container.scans.get(publicId)).toMatchObject({ status: 'failed', failureReason: 'internal_error', preliminary: false });
        // Nothing left to fail the second time.
        expect(await container.runner.reapStuck(900_000)).toBe(0);
    });

    it('is left alone while its job still waits or runs, however old, and while the queue cannot tell', async () => {
        const waiting = containerWithLostJobs({ enqueue: () => Promise.resolve(), isPending: () => Promise.resolve(true) });
        const { publicId } = await waiting.scans.create('example.com');
        clock.time += 60 * 60_000;
        expect(await waiting.runner.reapStuck(900_000)).toBe(0);
        expect(await waiting.scans.get(publicId)).toMatchObject({ status: 'running' });

        const unreachable = containerWithLostJobs({ enqueue: () => Promise.resolve(), isPending: () => Promise.reject(new Error('redis away')) });
        const second = await unreachable.scans.create('example.com');
        clock.time += 60 * 60_000;
        expect(await unreachable.runner.reapStuck(900_000)).toBe(0);
        expect(await unreachable.scans.get(second.publicId)).toMatchObject({ status: 'running' });
    });

    it('stops a run that is still going when the reaper fails its scan: no event after the end', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const base = fakeFetcher();
        const slow = { ...base, fetchPage: async (...args: Parameters<typeof base.fetchPage>) => (await gate, base.fetchPage(...args)) };
        const captured = captureLogs();
        const container = containerWithLostJobs(lostQueue(), slow, captured.logger);
        const { publicId } = await container.scans.create('example.com');
        const running = container.runner.run({ publicId });
        clock.time += 16 * 60_000;
        expect(await container.runner.reapStuck(900_000)).toBe(1);
        release();
        await running;
        expect(await container.scans.get(publicId)).toMatchObject({ status: 'failed', failureReason: 'internal_error', lastEventId: '2' });
        expect(captured.lines().some((line) => line['msg'] === 'scan ended elsewhere, run stopped')).toBe(true);
    });

    it('is judged by its last event, not by when it was created', async () => {
        const database = await testDatabase();
        const container = buildContainer(testConfig(), { clock: { now: () => new Date(clock.time) }, ids: sequentialIds(), fetcher: fakeFetcher(), queue: lostQueue(), database });
        clock.time = FIXED_TIME.getTime();
        const { publicId } = await container.scans.create('example.com');
        // An hour in the queue, then a run that has just published: not stuck.
        clock.time += 60 * 60_000;
        await createPostgresScanStore(database.db).publish(publicId, { type: 'page.fetched', ts: new Date(clock.time).toISOString(), data: { headers: {} } }, reduceScan);
        expect(await container.runner.reapStuck(180_000)).toBe(0);
        clock.time += 4 * 60_000;
        expect(await container.runner.reapStuck(180_000)).toBe(1);
        await database.close();
    });

    it('is failed at once when the queue gives up on its job, and a second time changes nothing', async () => {
        const container = containerWithLostJobs();
        const { publicId } = await container.scans.create('example.com');
        await container.runner.failLost(publicId);
        expect(await container.scans.get(publicId)).toMatchObject({ status: 'failed', failureReason: 'internal_error' });
        await expect(container.runner.failLost(publicId)).resolves.toBeUndefined();
    });

    it('is never failed by the reaper after it has finished', async () => {
        const container = testContainer();
        const { publicId } = await container.scans.create('example.com');
        await settled(container, publicId);
        expect(await container.runner.reapStuck(0)).toBe(0);
        expect(await container.scans.get(publicId)).toMatchObject({ status: 'completed' });
    });
});

describe('a job for a scan that already ended', () => {
    it('does nothing: no second set of events, and the log says it was skipped', async () => {
        const captured = captureLogs();
        const container = testContainer({}, fakeFetcher(), undefined, captured.logger);
        const { publicId } = await container.scans.create('example.com');
        await settled(container, publicId);
        const before = await container.scans.get(publicId);

        await container.runner.run({ publicId });
        expect(await container.scans.get(publicId)).toEqual(before);
        expect(captured.lines().some((line) => line['msg'] === 'scan already finished, job skipped')).toBe(true);
    });
});

describe('a scan that cannot be queued', () => {
    it('is failed at once and the caller gets an error, instead of a scan that never runs', async () => {
        const loaded = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
        if (!loaded.ok) throw new Error('config');
        const broken = { enqueue: () => Promise.reject(new Error('redis away')), isPending: () => Promise.resolve(false) };
        const container = buildContainer(loaded.config, { clock: { now: () => FIXED_TIME }, ids: sequentialIds(), fetcher: fakeFetcher(), queue: broken });
        await expect(container.scans.create('example.com')).rejects.toMatchObject({ code: 'INTERNAL' });
        expect(await container.scans.get('test-id-00000000000001')).toMatchObject({ status: 'failed', failureReason: 'internal_error' });
    });
});

describe('a scan run by another version than the one that queued it', () => {
    const queuedBy = async (totalChecks: number, extra: Array<Parameters<ReturnType<typeof createPostgresScanStore>['publish']>[1]> = []) => {
        const database = await testDatabase();
        const store = createPostgresScanStore(database.db);
        const publicId = 'scan-other-version-000';
        await store.create(emptySnapshot({ publicId, url: 'https://example.com/', domain: 'example.com', createdAt: FIXED_TIME.toISOString(), totalChecks }));
        const at = FIXED_TIME.toISOString();
        await store.publish(publicId, { type: 'scan.started', ts: at, data: { url: 'https://example.com/', domain: 'example.com', totalChecks } }, reduceScan);
        for (const draft of extra) await store.publish(publicId, draft, reduceScan);
        await database.db.update(scans).set({ engineVersion: 0 }).where(eq(scans.publicId, publicId));
        return { database, publicId };
    };

    it('runs with its own number of checks, and stamps its own score model version on completion', async () => {
        const { database, publicId } = await queuedBy(3);
        const container = testContainer({}, fakeFetcher(), database);
        await container.runner.run({ publicId });
        const done = await container.scans.get(publicId);
        expect(done).toMatchObject({ status: 'completed', totalChecks: CHECKS.length });
        expect(done.checks).toHaveLength(CHECKS.length);
        const [row] = await database.db.select({ engineVersion: scans.engineVersion }).from(scans).where(eq(scans.publicId, publicId));
        expect(row?.engineVersion).toBe(SCORE_MODEL_VERSION);
        await database.close();
    });

    it('drops what an earlier run left behind when it takes a scan over, such as a check this version no longer has', async () => {
        const stale = { checkId: 'removed_check', category: 'security', layer: 'light', status: 'fail', severity: 'high', effort: 'hours', evidence: {}, pointsLost: 40 } as const;
        const { database, publicId } = await queuedBy(CHECKS.length, [{ type: 'check.completed', ts: FIXED_TIME.toISOString(), data: stale }]);
        const container = testContainer({}, fakeFetcher(), database);
        await container.runner.run({ publicId });
        const done = await container.scans.get(publicId);
        expect(done.status).toBe('completed');
        expect(done.checks.map((check) => check.checkId)).not.toContain('removed_check');
        expect(done.checks).toHaveLength(CHECKS.length);
        await database.close();
    });
});

describe('a run that another run has taken over', () => {
    it('stops quietly: none of its events reach the scan', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const base = fakeFetcher();
        const slow = { ...base, fetchPage: async (...args: Parameters<typeof base.fetchPage>) => (await gate, base.fetchPage(...args)) };
        const database = await testDatabase();
        const captured = captureLogs();
        const container = buildContainer(testConfig(), { clock: { now: () => FIXED_TIME }, ids: sequentialIds(), fetcher: slow, queue: lostQueue(), database, logger: captured.logger });
        const { publicId } = await container.scans.create('example.com');
        const stale = container.runner.run({ publicId });
        // While it waits on the site, BullMQ hands the job to another worker, whose run starts the scan over.
        await new Promise((resolve) => setTimeout(resolve, 10));
        const at = FIXED_TIME.toISOString();
        const store = createPostgresScanStore(database.db);
        await store.publish(
            publicId,
            { type: 'scan.started', ts: at, data: { url: 'https://example.com/', domain: 'example.com', totalChecks: CHECKS.length, runId: 'other-run' } },
            reduceScan,
            undefined,
            'other-run',
        );
        release();
        await stale;
        expect(await store.get(publicId)).toMatchObject({ status: 'running', runId: 'other-run', lastEventId: '2', checks: [] });
        // The run is the store's bookkeeping: a client never sees it.
        expect(await container.scans.get(publicId)).not.toHaveProperty('runId');
        expect(captured.lines().some((line) => line['msg'] === 'scan taken over by another run, run stopped')).toBe(true);
        await database.close();
    });
});

describe('the reaper', () => {
    it('makes its first pass at once, with the shorter age when given one, and stops when told', async () => {
        const ages: number[] = [];
        const stop = startReaper({ reapStuck: (age) => (ages.push(age), Promise.resolve(0)) }, { error: () => undefined }, 900_000, 0);
        stop();
        expect(ages).toEqual([0]);
    });
});
