import { randomUUID } from 'node:crypto';
import { emptySnapshot, reduceScan } from '@sitehp.app/core';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { connectDatabase, type Database } from '@modules/scans/infrastructure/postgres/connect.ts';
import { createPostgresScanStore, createPostgresSiteLog } from '@modules/scans/infrastructure/postgres/stores.ts';
import type { SiteRequestOutcome } from '@modules/scans/ports.ts';
import { FIXED_TIME } from '@tests/helpers.ts';

/**
 * What PGlite cannot show, against a real PostgreSQL (`docker compose up -d`, then DATABASE_URL=postgres://sitehp:sitehp@localhost:5433/sitehp):
 * several processes migrating at once, and the row lock under real concurrency. Each run makes a database of its own and drops it.
 * Skipped without DATABASE_URL locally; CI starts a Postgres service and sets it, and a CI run without it fails instead of skipping.
 */
const url = process.env['DATABASE_URL'];
if (process.env['CI'] && url === undefined) throw new Error('DATABASE_URL is not set: CI must run the PostgreSQL tests, not skip them');

describe.skipIf(url === undefined)('a real PostgreSQL', () => {
    const name = `sitehp_test_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(url ?? '', { max: 1, onnotice: () => undefined });
    const fresh = () => {
        const target = new URL(url ?? '');
        target.pathname = `/${name}`;
        return target.href;
    };
    const opened: Database[] = [];

    afterAll(async () => {
        await Promise.all(opened.map((database) => database.close()));
        await admin.unsafe(`drop database if exists ${name} with (force)`);
        await admin.end();
    });

    it('lets several processes start at once on an empty database: one migrates, the others wait and find nothing to do', async () => {
        await admin.unsafe(`create database ${name}`);
        const databases = await Promise.all(Array.from({ length: 4 }, () => connectDatabase(fresh())));
        opened.push(...databases);
        expect(databases).toHaveLength(4);
    });

    it('gives out every event id once when publishes really run at the same time (the row lock)', async () => {
        const database = opened[0];
        if (database === undefined) throw new Error('the database was not opened');
        const store = createPostgresScanStore(database.db);
        const publicId = 'scan-concurrent-000000';
        await store.create(emptySnapshot({ publicId, url: 'https://example.com/', domain: 'example.com', createdAt: FIXED_TIME.toISOString(), totalChecks: 3 }));
        const results = await Promise.all(Array.from({ length: 16 }, () => store.publish(publicId, { type: 'page.fetched', ts: FIXED_TIME.toISOString(), data: { headers: {} } }, reduceScan)));
        expect(results.map((result) => Number(result.event.id)).sort((left, right) => left - right)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    });

    it('keeps one row per domain and loses no count when a hundred requests for it arrive at once', async () => {
        const database = opened[0];
        if (database === undefined) throw new Error('the database was not opened');
        const log = createPostgresSiteLog(database.db);
        const outcomes: SiteRequestOutcome[] = Array.from({ length: 100 }, (_, index) => (index % 10 === 0 ? 'scan' : index % 10 === 1 ? 'limited' : 'reused'));
        await Promise.all(outcomes.map((outcome) => log.recordRequest('crowded.example', FIXED_TIME, outcome)));
        const rows = (await log.list()).filter((site) => site.domain === 'crowded.example');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ requestCount: 100, scanCount: 10, blockedCount: 0 });
    });
});
