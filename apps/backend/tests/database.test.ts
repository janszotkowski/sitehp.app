import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@config/env.ts';
import { stuckAfterMs } from '@composition/reaper.ts';
import { createApp } from '@composition/app.ts';
import { buildContainer, streamPollMs } from '@composition/deps.ts';
import type { Database } from '@modules/scans/infrastructure/postgres/connect.ts';
import { createPostgresScanStore, createPostgresSiteLog } from '@modules/scans/infrastructure/postgres/stores.ts';
import { fakeFetcher, FIXED_TIME, testContainer, testDatabase } from '@tests/helpers.ts';
import { scanEvents, scans as scansTable } from '@modules/scans/infrastructure/postgres/schema.ts';
import { SCORE_MODEL_VERSION } from '@sitehp.app/core';
import { eq } from 'drizzle-orm';

// A fresh database for every test: the test ids are sequential, so two containers must not share one.
let database: Database;
beforeEach(async () => {
    database = await testDatabase();
});
afterEach(() => database.close());

const settled = async (get: () => Promise<{ status: string }>) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
        if ((await get()).status !== 'running') return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('the scan never finished');
};

describe('scans kept in PostgreSQL', () => {
    it('runs a whole scan through the database and serves it back over HTTP', async () => {
        const container = testContainer({}, fakeFetcher(), database);
        const app = createApp(container);
        const response = await app.request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'example.com' }) });
        expect(response.status).toBe(201);
        const { publicId } = (await response.json()) as { publicId: string };
        await settled(() => container.scans.get(publicId));

        const read = await app.request(`/v1/scans/${publicId}`);
        expect(await read.json()).toMatchObject({ status: 'completed', score: 100, preliminary: false });
        // The stream replays from the database, and ends after the terminal event.
        const stream = await app.request(`/v1/scans/${publicId}/events`);
        expect(await stream.text()).toContain('event: scan.completed');

        // The row carries the score model it was computed with.
        const [row] = await database.db.select().from(scansTable).where(eq(scansTable.publicId, publicId));
        expect(row).toMatchObject({ domain: 'example.com', status: 'completed', score: 100, engineVersion: SCORE_MODEL_VERSION });
    });

    it('records every requested domain for good, with the score, and the refused ones, keeping only the host', async () => {
        const container = testContainer({}, fakeFetcher(), database);
        const { publicId } = await container.scans.create('https://shop.example/private/page?token=secret#frag');
        await settled(() => container.scans.get(publicId));
        const { score } = await container.scans.get(publicId);
        expect(score).not.toBeNull();
        await expect(container.scans.create('https://news.example.ru/x')).rejects.toMatchObject({ code: 'DOMAIN_BLOCKED' });

        const list = await createPostgresSiteLog(database.db).list();
        const shop = list.find((site) => site.domain === 'shop.example');
        expect(shop).toMatchObject({ scanCount: 1, blockedCount: 0, lastScore: score });
        // A refusal is counted under the rule that blocked it, not the host.
        expect(list.find((site) => site.domain === '*.ru')).toMatchObject({ scanCount: 0, blockedCount: 1 });
        expect(list.some((site) => site.domain === 'news.example.ru')).toBe(false);
        // Nothing but the host is kept: no path, query or caller.
        expect(JSON.stringify(list)).not.toMatch(/token|private|frag/);
    });

    it('deletes reports older than the retention but keeps the list of domains', async () => {
        const later = new Date(FIXED_TIME.getTime() + 31 * 86_400_000);
        const container = testContainer({ SCAN_RETENTION_MS: String(30 * 86_400_000) }, fakeFetcher(), database);
        const { publicId } = await container.scans.create('kept.example');
        await settled(() => container.scans.get(publicId));
        expect(await container.scans.get(publicId)).toBeDefined();

        // 31 days on, the next purge removes the report (the scan row and its log) and not the domain.
        const loaded = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
        if (!loaded.ok) throw new Error('config');
        const aged = buildContainer(loaded.config, { clock: { now: () => later }, database });
        const store = createPostgresScanStore(database.db);
        // Directly, not by waiting on the purge the container starts (that one may run first and find nothing, which is fine too).
        await store.deleteOlderThan(new Date(later.getTime() - 30 * 86_400_000));
        await expect(aged.scans.get(publicId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        // The log goes with the scan (ON DELETE CASCADE).
        expect(await database.db.select().from(scanEvents).where(eq(scanEvents.scanId, publicId))).toEqual([]);
        expect((await createPostgresSiteLog(database.db).list()).some((site) => site.domain === 'kept.example')).toBe(true);
    });
});

describe('the wiring around the database', () => {
    it('lets only the process told to delete expired reports (the worker, or an API that runs the scans itself)', async () => {
        const container = testContainer({}, fakeFetcher(), database);
        const { publicId } = await container.scans.create('old.example');
        await settled(() => container.scans.get(publicId));
        const loaded = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
        if (!loaded.ok) throw new Error('config');
        const later = { now: () => new Date(FIXED_TIME.getTime() + 31 * 86_400_000) };

        const api = buildContainer(loaded.config, { clock: later, database, purge: false });
        await new Promise((resolve) => setTimeout(resolve, 50));
        await expect(api.scans.get(publicId)).resolves.toBeDefined();

        const worker = buildContainer(loaded.config, { clock: later, database });
        for (let attempt = 0; attempt < 400 && (await database.db.select().from(scansTable).where(eq(scansTable.publicId, publicId))).length > 0; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await expect(worker.scans.get(publicId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('has a live stream look in the database every second, and every 15 s when other processes signal a change', () => {
        expect(streamPollMs(undefined)).toBe(1000);
        expect(streamPollMs({ notify: () => Promise.resolve(), subscribe: () => () => undefined })).toBe(15_000);
    });
});

describe('configuration for the database', () => {
    it('requires DATABASE_URL in production and accepts a postgres address', () => {
        expect(loadConfig({ NODE_ENV: 'production' }).ok).toBe(false);
        expect(
            loadConfig({
                NODE_ENV: 'production',
                REDIS_URL: 'redis://localhost:6379',
                DATABASE_URL: 'postgres://u:p@localhost:5432/sitehp',
                CORS_ORIGINS: 'https://sitehp.app',
            }).ok,
        ).toBe(true);
        expect(loadConfig({ DATABASE_URL: 'mysql://localhost/db' }).ok).toBe(false);
        expect(loadConfig({}).ok).toBe(true);
    });

    it('accepts REDIS_URL only with the shared database, and requires it in production', () => {
        const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/sitehp' };
        expect(loadConfig({ REDIS_URL: 'redis://localhost:6379', ...base }).ok).toBe(true);
        expect(loadConfig({ REDIS_URL: 'rediss://user:pw@cache.example:6380', ...base }).ok).toBe(true);
        // A worker in another process cannot see scans that live in the API's memory.
        expect(loadConfig({ REDIS_URL: 'redis://localhost:6379' }).ok).toBe(false);
        expect(loadConfig({ REDIS_URL: 'http://localhost:6379', ...base }).ok).toBe(false);
        expect(loadConfig({ NODE_ENV: 'production', ...base }).ok).toBe(false);
        expect(
            loadConfig({
                NODE_ENV: 'production',
                REDIS_URL: 'redis://localhost:6379',
                CORS_ORIGINS: 'https://sitehp.app',
                ...base,
            }).ok,
        ).toBe(true);
    });

    it('judges a scan stuck a minute after its deadline has passed without an event', () => {
        const loaded = loadConfig({ SCAN_DEADLINE_MS: '120000' });
        expect(loaded.ok && stuckAfterMs(loaded.config)).toBe(180_000);
    });

    it('keeps reports for 30 days by default', () => {
        const loaded = loadConfig({});
        expect(loaded.ok && loaded.config.SCAN_RETENTION_MS).toBe(30 * 86_400_000);
    });
});
