import { SCORE_MODEL_VERSION, emptySnapshot, reduceScan, type ScanSnapshot } from '@sitehp.app/core';
import { eq } from 'drizzle-orm';
import { scans } from '@modules/scans/infrastructure/postgres/schema.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryScanStore, createInMemorySiteLog } from '@modules/scans/infrastructure/in-memory.ts';
import { createPostgresScanStore, createPostgresSiteLog } from '@modules/scans/infrastructure/postgres/stores.ts';
import { RunTakenOverError, ScanFinishedError, type ScanStore, type SiteLog } from '@modules/scans/ports.ts';
import { FIXED_TIME, testDatabase } from '@tests/helpers.ts';
import type { Database } from '@modules/scans/infrastructure/postgres/connect.ts';

/** The same behaviour from both stores: whatever the in-memory one promises, PostgreSQL keeps. */

let database: Database;
beforeAll(async () => {
    database = await testDatabase();
});
afterAll(() => database.close());

const ID = 'x'.repeat(22);
const snapshot = (publicId = ID, createdAt = FIXED_TIME) => emptySnapshot({ publicId, url: 'https://example.com/', domain: 'example.com', createdAt: createdAt.toISOString(), totalChecks: 3 });
const at = FIXED_TIME.toISOString();
const started = { type: 'scan.started', ts: at, data: { url: 'https://example.com/', domain: 'example.com', totalChecks: 3 } } as const;
const failed = { type: 'scan.failed', ts: at, data: { reason: 'unreachable' } } as const;

const stores: Array<[string, () => ScanStore]> = [
    ['in memory', () => createInMemoryScanStore()],
    ['PostgreSQL', () => createPostgresScanStore(database.db, 20)],
];

describe.each(stores)('scan store: %s', (_name, make) => {
    // Postgres keeps its rows between tests: every test uses ids of its own.
    let n = 0;
    const id = () => `scan-${String((n += 1)).padStart(17, '0')}-${_name === 'PostgreSQL' ? 'p' : 'm'}`.slice(0, 22).padEnd(22, '0');

    it('keeps a scan and gives back exactly what it was given', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        expect(await store.get(publicId)).toEqual(snapshot(publicId));
        expect(await store.get(id())).toBeUndefined();
    });

    it('appends the event and folds it into the snapshot in one step, numbering events from 1', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        const first = await store.publish(publicId, started, reduceScan);
        expect(first.event.id).toBe('1');
        expect(first.snapshot.lastEventId).toBe('1');
        const second = await store.publish(publicId, failed, reduceScan);
        expect(second.event.id).toBe('2');
        expect(await store.get(publicId)).toEqual(second.snapshot);
        expect(second.snapshot).toMatchObject({ status: 'failed', failureReason: 'unreachable' });
    });

    it('changes neither the log nor the snapshot when folding fails', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        await expect(
            store.publish(publicId, started, () => {
                throw new Error('fold failed');
            }),
        ).rejects.toThrow('fold failed');
        expect(await store.get(publicId)).toEqual(snapshot(publicId));
        expect((await store.publish(publicId, started, reduceScan)).event.id).toBe('1');
    });

    it('appends an event derived from the folded snapshot in the same step, right after it', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        await store.publish(publicId, started, reduceScan);
        const check = { type: 'page.fetched', ts: at, data: { headers: { a: '1' } } } as const;
        const result = await store.publish(publicId, check, reduceScan, (folded) => ({ type: 'page.fetched', ts: at, data: { headers: { b: String(folded.lastEventId) } } }));
        expect([result.event.id, result.followUp?.id]).toEqual(['2', '3']);
        // The follow-up saw the snapshot with the first event already in it.
        expect(result.snapshot).toMatchObject({ lastEventId: '3', responseHeaders: { b: '2' } });
        expect(await store.get(publicId)).toEqual(result.snapshot);
        const ids: string[] = [];
        for await (const event of store.follow(publicId, undefined, new AbortController().signal)) {
            ids.push(event.id);
            if (ids.length === 3) break;
        }
        expect(ids).toEqual(['1', '2', '3']);
        // Nothing derived: one event, as before.
        expect((await store.publish(publicId, check, reduceScan, () => undefined)).followUp).toBeUndefined();
    });

    it('appends neither event when deriving the second one fails', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        await expect(
            store.publish(publicId, started, reduceScan, () => {
                throw new Error('derive failed');
            }),
        ).rejects.toThrow('derive failed');
        expect(await store.get(publicId)).toEqual(snapshot(publicId));
        expect((await store.publish(publicId, started, reduceScan)).event.id).toBe('1');
    });

    it('refuses to publish to a scan that does not exist', async () => {
        await expect(make().publish(id(), started, reduceScan)).rejects.toThrow('unknown scan');
    });

    // PGlite has one connection and runs transactions one after another, so this checks the sequence, not the row lock (`FOR UPDATE`)
    // that keeps it under real concurrency on PostgreSQL; `tests/postgres.test.ts` checks that against a real server.
    it('gives out every id once, in sequence, when publishes overlap', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        const results = await Promise.all(Array.from({ length: 8 }, () => store.publish(publicId, { type: 'page.fetched', ts: at, data: { headers: {} } }, reduceScan)));
        expect(results.map((result) => Number(result.event.id)).sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('replays the log from where the reader left off, and ends after the terminal event', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        await store.publish(publicId, started, reduceScan);
        await store.publish(publicId, failed, reduceScan);
        const read = async (after?: string) => {
            const ids: string[] = [];
            for await (const event of store.follow(publicId, after, new AbortController().signal)) ids.push(event.id);
            return ids;
        };
        expect(await read()).toEqual(['1', '2']);
        expect(await read('1')).toEqual(['2']);
        // Resumed after the end: an empty, finished stream, not one that waits for ever.
        expect(await read('2')).toEqual([]);
    });

    it('wakes a follower when an event arrives, and ends it at the terminal event', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        const seen: string[] = [];
        const reading = (async () => {
            for await (const event of store.follow(publicId, undefined, new AbortController().signal)) seen.push(event.type);
        })();
        await store.publish(publicId, started, reduceScan);
        await store.publish(publicId, failed, reduceScan);
        await reading;
        expect(seen).toEqual(['scan.started', 'scan.failed']);
    });

    it('stops a follower whose signal is aborted', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        const controller = new AbortController();
        const reading = (async () => {
            for await (const event of store.follow(publicId, undefined, controller.signal)) void event;
        })();
        controller.abort();
        await expect(reading).resolves.toBeUndefined();
    });

    it('refuses an event for a scan that has ended, and keeps the log and the snapshot as they were', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        await store.publish(publicId, started, reduceScan);
        await store.publish(publicId, failed, reduceScan);
        const before = await store.get(publicId);
        await expect(store.publish(publicId, { type: 'scan.completed', ts: at, data: { score: 100 } }, reduceScan)).rejects.toBeInstanceOf(ScanFinishedError);
        expect(await store.get(publicId)).toEqual(before);
        const events = [];
        for await (const event of store.follow(publicId, undefined, new AbortController().signal)) events.push(event.type);
        expect(events).toEqual(['scan.started', 'scan.failed']);
    });

    it('lists the scans still running with no event since a time, and not the finished, the busy or the newer', async () => {
        const store = make();
        const lost = id();
        const busy = id();
        const done = id();
        const fresh = id();
        const oldTime = new Date(FIXED_TIME.getTime() - 3_600_000);
        for (const publicId of [lost, busy, done]) await store.create(snapshot(publicId, oldTime));
        await store.create(snapshot(fresh));
        await store.publish(lost, { ...started, ts: oldTime.toISOString() }, reduceScan);
        // Created long ago, but its run published a minute ago: still alive.
        await store.publish(busy, { ...started, ts: oldTime.toISOString() }, reduceScan);
        await store.publish(busy, { ...started, ts: new Date(FIXED_TIME.getTime() - 30_000).toISOString() }, reduceScan);
        await store.publish(done, failed, reduceScan);
        const stale = await store.listRunningIdleSince(new Date(FIXED_TIME.getTime() - 60_000));
        expect(stale).toContain(lost);
        expect(stale).not.toContain(busy);
        expect(stale).not.toContain(done);
        expect(stale).not.toContain(fresh);
    });

    it('takes events of the run that owns the scan only: the first event claims it, a scan.started takes it over', async () => {
        const store = make();
        const publicId = id();
        await store.create(snapshot(publicId));
        // The API's scan.started names no run.
        await store.publish(publicId, started, reduceScan);
        const headers = { type: 'page.fetched', ts: at, data: { headers: {} } } as const;
        expect((await store.publish(publicId, headers, reduceScan, undefined, 'run-a')).snapshot.runId).toBe('run-a');
        await expect(store.publish(publicId, headers, reduceScan, undefined, 'run-b')).rejects.toBeInstanceOf(RunTakenOverError);
        // A stalled run's job handed to another worker: its scan.started takes the scan over, and the old run is refused from then on.
        await store.publish(publicId, { ...started, data: { ...started.data, runId: 'run-b' } }, reduceScan, undefined, 'run-b');
        const before = await store.get(publicId);
        await expect(store.publish(publicId, { type: 'scan.completed', ts: at, data: { score: 1 } }, reduceScan, undefined, 'run-a')).rejects.toBeInstanceOf(ScanFinishedError);
        expect(await store.get(publicId)).toEqual(before);
        // Without a run (the reaper) an event is taken as before.
        expect((await store.publish(publicId, failed, reduceScan)).snapshot).toMatchObject({ status: 'failed', runId: 'run-b' });
    });

    it('hands out a recent scan only when it was made with the current score model', async () => {
        const store = make();
        const url = `https://model-${_name === 'PostgreSQL' ? 'p' : 'm'}.example.com/`;
        const publicId = id();
        await store.create({ ...snapshot(publicId), url });
        await store.publish(publicId, { type: 'scan.completed', ts: at, data: { score: 90, scoreModelVersion: SCORE_MODEL_VERSION } }, reduceScan);
        expect(await store.findRecent(url, new Date(FIXED_TIME.getTime() - 60_000))).toMatchObject({ publicId, scoreModelVersion: SCORE_MODEL_VERSION });
        const older = id();
        await store.create({ ...snapshot(older, new Date(FIXED_TIME.getTime() + 1000)), url });
        await store.publish(older, { type: 'scan.completed', ts: at, data: { score: 90, scoreModelVersion: SCORE_MODEL_VERSION - 1 } }, reduceScan);
        if (_name === 'PostgreSQL')
            await database.db
                .update(scans)
                .set({ engineVersion: SCORE_MODEL_VERSION - 1 })
                .where(eq(scans.publicId, older));
        expect((await store.findRecent(url, new Date(FIXED_TIME.getTime() - 60_000)))?.publicId).toBe(publicId);
    });

    it('finds the latest scan of a URL within the window that has not failed, running or completed, and not an older one', async () => {
        const store = make();
        const url = `https://reuse-${_name === 'PostgreSQL' ? 'p' : 'm'}.example.com/`;
        const scanOf = async (createdAt: Date, end: 'completed' | 'failed' | 'running') => {
            const publicId = id();
            await store.create({ ...snapshot(publicId, createdAt), url });
            if (end === 'completed') await store.publish(publicId, { type: 'scan.completed', ts: at, data: { score: 90 } }, reduceScan);
            if (end === 'failed') await store.publish(publicId, failed, reduceScan);
            return publicId;
        };
        const minutesAgo = (minutes: number) => new Date(FIXED_TIME.getTime() - minutes * 60_000);
        await scanOf(minutesAgo(120), 'completed');
        const completed = await scanOf(minutesAgo(30), 'completed');
        await scanOf(minutesAgo(20), 'failed');
        const running = await scanOf(minutesAgo(10), 'running');

        expect((await store.findRecent(url, minutesAgo(60)))?.publicId).toBe(running);
        expect((await store.findRecent(url, minutesAgo(40)))?.publicId).toBe(running);
        expect(await store.findRecent(url, minutesAgo(5))).toBeUndefined();
        expect(await store.findRecent(`${url}other`, minutesAgo(60))).toBeUndefined();
        expect(completed).not.toBe(running);
    });

    it('skips a newer scan with a choice of checks and finds the full one behind it', async () => {
        const store = make();
        const url = `https://custom-${_name === 'PostgreSQL' ? 'p' : 'm'}.example.com/`;
        const full = id();
        await store.create({ ...snapshot(full, new Date(FIXED_TIME.getTime() - 120_000)), url });
        await store.create({ ...snapshot(id(), new Date(FIXED_TIME.getTime() - 60_000)), url, selectedChecks: ['http_status', 'hsts'] });
        expect((await store.findRecent(url, new Date(FIXED_TIME.getTime() - 600_000)))?.publicId).toBe(full);
    });

    it('deletes scans created before the cutoff with their log, and ends a follower of one', async () => {
        const store = make();
        const old = id();
        const recent = id();
        await store.create(snapshot(old, new Date(FIXED_TIME.getTime() - 40 * 86_400_000)));
        await store.create(snapshot(recent));
        await store.publish(old, started, reduceScan);
        const reading = (async () => {
            for await (const event of store.follow(old, '1', new AbortController().signal)) void event;
        })();
        expect(await store.deleteOlderThan(new Date(FIXED_TIME.getTime() - 30 * 86_400_000))).toBe(1);
        await expect(reading).resolves.toBeUndefined();
        expect(await store.get(old)).toBeUndefined();
        expect(await store.get(recent)).toBeDefined();
    });
});

describe('PostgreSQL scan store: what older rows lack', () => {
    it('gives a completed scan stored before snapshots carried it the score model version of its column', async () => {
        const store = createPostgresScanStore(database.db, 20);
        const publicId = 'old-row'.padEnd(22, '0');
        await store.create(snapshot(publicId));
        await store.publish(publicId, { type: 'scan.completed', ts: at, data: { score: 70 } }, reduceScan);
        const raw = (await store.get(publicId)) as ScanSnapshot;
        const { scoreModelVersion: _version, ...old } = raw;
        await database.db.update(scans).set({ snapshot: old, engineVersion: 2 }).where(eq(scans.publicId, publicId));
        expect(await store.get(publicId)).toMatchObject({ status: 'completed', scoreModelVersion: 2 });
    });

    it('deletes expired scans in batches, all of them', async () => {
        const store = createPostgresScanStore(database.db, 20, undefined, 2);
        const old = new Date(FIXED_TIME.getTime() - 400 * 86_400_000);
        for (let n = 0; n < 5; n += 1) await store.create(snapshot(`batch-${n}`.padEnd(22, '0'), old));
        expect(await store.deleteOlderThan(new Date(old.getTime() + 1000))).toBe(5);
        expect(await store.get('batch-0'.padEnd(22, '0'))).toBeUndefined();
    });
});

const logs: Array<[string, () => SiteLog]> = [
    ['in memory', () => createInMemorySiteLog()],
    ['PostgreSQL', () => createPostgresSiteLog(database.db)],
];

describe.each(logs)('list of scanned domains: %s', (name, make) => {
    // Postgres keeps its rows between tests: every test uses domains of its own.
    const domain = (label: string) => `${label}-${name === 'PostgreSQL' ? 'pg' : 'mem'}.example`;
    const day = (n: number) => new Date(Date.UTC(2026, 9, n));

    it('counts requests and refusals per domain and remembers the first and the last time', async () => {
        const log = make();
        const name = domain('counted');
        await log.recordRequest(name, day(1), 'scan');
        await log.recordRequest(name, day(2), 'scan');
        await log.recordRequest(name, day(2), 'reused');
        await log.recordRequest(name, day(2), 'limited');
        await log.recordRequest(name, day(3), 'blocked');
        const site = (await log.list()).find((entry) => entry.domain === name);
        expect(site).toMatchObject({ requestCount: 4, scanCount: 2, blockedCount: 1, lastScore: null, lastScanAt: null });
        expect(site?.firstSeenAt).toEqual(day(1));
        expect(site?.lastSeenAt).toEqual(day(3));
    });

    it('keeps the score of the most recently started scan, whatever order they finish in, and ignores a result for a domain it never saw', async () => {
        const log = make();
        const name = domain('scored');
        await log.recordRequest(name, day(1), 'scan');
        await log.recordResult(name, 61, day(1));
        await log.recordResult(name, 74, day(2));
        // A scan that started earlier and finished later does not overwrite the newer score.
        await log.recordResult(name, 40, day(1));
        await log.recordResult(domain('never-seen'), 50, day(2));
        const list = await log.list();
        expect(list.find((entry) => entry.domain === name)).toMatchObject({ lastScore: 74, lastScanAt: day(2) });
        expect(list.find((entry) => entry.domain === domain('never-seen'))).toBeUndefined();
    });

    it('lists the most recently seen domain first', async () => {
        const log = make();
        const older = domain('older');
        const newer = domain('newer');
        await log.recordRequest(older, day(10), 'scan');
        await log.recordRequest(newer, day(11), 'scan');
        const names = (await log.list()).map((entry) => entry.domain);
        expect(names.indexOf(newer)).toBeLessThan(names.indexOf(older));
    });
});

describe('PostgreSQL scan store: a follower in another process', () => {
    it('wakes at once on a signal, long before its own next look', async () => {
        // Two stores on one database stand for the API and a worker; the signal stands for Redis.
        const listeners = new Map<string, Set<() => void>>();
        const signal = {
            notify: (publicId: string) => {
                for (const wake of listeners.get(publicId) ?? []) wake();
                return Promise.resolve();
            },
            subscribe: (publicId: string, onWake: () => void) => {
                const set = listeners.get(publicId) ?? new Set<() => void>();
                listeners.set(publicId, set);
                set.add(onWake);
                return () => void set.delete(onWake);
            },
        };
        const api = createPostgresScanStore(database.db, 60_000, signal);
        const worker = createPostgresScanStore(database.db, 60_000, signal);
        const publicId = 'signal-test'.padEnd(22, '0');
        await api.create(snapshot(publicId));

        const seen: string[] = [];
        const reading = (async () => {
            for await (const event of api.follow(publicId, undefined, new AbortController().signal)) seen.push(event.type);
        })();
        // The follower's own look is a minute away: only the signal can wake it.
        await new Promise((resolve) => setTimeout(resolve, 30));
        const startedAt = performance.now();
        await worker.publish(publicId, started, reduceScan);
        await worker.publish(publicId, failed, reduceScan);
        await reading;
        expect(seen).toEqual(['scan.started', 'scan.failed']);
        expect(performance.now() - startedAt).toBeLessThan(2000);
    });
});
