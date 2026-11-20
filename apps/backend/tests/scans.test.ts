import { createRateLimiter } from '@platform/rate-limit.ts';
import { getEventListeners } from 'node:events';
import {
    CHECK_IDS,
    CRITICAL_CAP,
    SCORE_MODEL_VERSION,
    createScanResponseSchema,
    hideQueryValues,
    emptySnapshot,
    errorResponseSchema,
    reduceScan,
    scanEventSchema,
    scanSnapshotSchema,
} from '@sitehp.app/core';
import { createApp } from '@composition/app.ts';
import { createScansService, type ScansService } from '@modules/scans/application/scans-service.ts';
import { createInlineJobQueue, createInMemoryScanStore, createInMemorySiteLog } from '@modules/scans/infrastructure/in-memory.ts';
import { AppError } from '@platform/errors.ts';
import type { Logger } from '@platform/logger.ts';
import type { ScanStore, SiteFetcher } from '@modules/scans/ports.ts';
import { describe, expect, it } from 'vitest';
import { FIXED_TIME, cannedPage, captureLogs, fakeFetcher, goodCertificate, parseSse, sequentialIds, testConfig, testContainer } from '@tests/helpers.ts';

/** Id of the last event of a finished scan: started, fetched, a check and a score per check, completed. */
const LAST = 3 + 2 * CHECK_IDS.length;

const settled = async (scans: ScansService, publicId: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const snapshot = await scans.get(publicId);
        if (snapshot.status !== 'running') return snapshot;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('the scan never finished');
};

const post = (app: ReturnType<typeof createApp>, body: unknown, raw?: string) =>
    app.request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });

describe('scans with a choice of checks', () => {
    const CHOICE = ['hsts', 'seo_title'];

    it('runs only the chosen checks and the ones that must always run, and says so in the snapshot', async () => {
        const { scans } = testContainer();
        const started = await scans.create('example.com', undefined, undefined, false, CHOICE);
        expect(started).toMatchObject({ totalChecks: 3, selectedChecks: ['http_status', 'hsts', 'seo_title'] });
        const done = await settled(scans, started.publicId);
        expect(done.checks.map((check) => check.checkId).sort()).toEqual(['hsts', 'http_status', 'seo_title']);
        expect(done.status).toBe('completed');
        expect(done.score).not.toBeNull();
    });

    it('treats a choice that covers every check as a plain full scan', async () => {
        const { scans } = testContainer();
        const snapshot = await scans.create('example.com', undefined, undefined, false, CHECK_IDS);
        expect(snapshot.selectedChecks).toBeUndefined();
        expect(snapshot.totalChecks).toBe(CHECK_IDS.length);
    });

    it('refuses an unknown check, over the API as a validation error', async () => {
        const { scans } = testContainer();
        await expect(scans.create('example.com', undefined, undefined, false, ['hsts', 'not_a_check'])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        const app = createApp(testContainer());
        const refused = await post(app, { url: 'example.com', checks: ['nope'] });
        expect(refused.status).toBe(400);
        expect((await post(app, { url: 'example.com', checks: [] })).status).toBe(400);
    });

    it('is never handed out in place of a full scan, and a full scan is never handed out for it', async () => {
        const { scans } = testContainer({ SCAN_REUSE_MS: String(10 * 60_000) });
        const full = await scans.create('example.com', '203.0.113.9');
        const custom = await scans.create('example.com', '203.0.113.9', undefined, false, CHOICE);
        expect(custom.publicId).not.toBe(full.publicId);
        const again = await scans.create('example.com', '203.0.113.9');
        // The newer custom scan does not hide the full one behind it.
        expect(again.publicId).toBe(full.publicId);
    });
});

describe('scans service', () => {
    it('creates a scan whose first snapshot already carries scan.started', async () => {
        const { scans } = testContainer();
        const snapshot = await scans.create('example.com');
        expect(snapshot).toMatchObject({ status: 'running', url: 'https://example.com/', domain: 'example.com', totalChecks: CHECK_IDS.length, lastEventId: '1', preliminary: true });
        expect(snapshot.publicId).toHaveLength(22);
    });

    it('runs every check, publishing one event after each, and completes with the score', async () => {
        const { scans } = testContainer();
        const { publicId } = await scans.create('example.com');
        await settled(scans, publicId);

        const seen: string[] = [];
        for await (const event of scans.follow(publicId, undefined, new AbortController().signal)) seen.push(event.type);
        expect(seen).toEqual(['scan.started', 'page.fetched', ...Array.from({ length: CHECK_IDS.length }).flatMap(() => ['check.completed', 'score.updated']), 'scan.completed']);

        expect(await scans.get(publicId)).toMatchObject({ status: 'completed', score: 100, preliminary: false, lastEventId: String(LAST), scoreModelVersion: SCORE_MODEL_VERSION });
    });

    it('holds an address that stays on http at the critical cap, with the failing check in the snapshot', async () => {
        const { scans } = testContainer({}, fakeFetcher({ ok: true, page: cannedPage({ finalUrl: 'http://example.com/' }) }));
        const { publicId } = await scans.create('http://example.com');
        const done = await settled(scans, publicId);
        expect(done.score).toBe(CRITICAL_CAP);
        expect(done.checks.find((check) => check.checkId === 'https_scheme')).toMatchObject({ status: 'fail', evidence: { scheme: 'http', finalScheme: 'http' } });
    });

    it('keeps the response headers for the raw view, without set-cookie', async () => {
        const page = cannedPage({ headers: { server: 'nginx', 'set-cookie': 'session=secret; HttpOnly' } });
        const { scans } = testContainer({}, fakeFetcher({ ok: true, page }));
        const { publicId } = await scans.create('example.com');
        const done = await settled(scans, publicId);
        expect(done.responseHeaders).toEqual({ server: 'nginx' });
    });

    it('passes the https check for an http address that redirects to https', async () => {
        const page = cannedPage({ finalUrl: 'https://example.com/', redirects: [{ from: 'http://example.com/', to: 'https://example.com/', status: 301 }] });
        const { scans } = testContainer({}, fakeFetcher({ ok: true, page }));
        const { publicId } = await scans.create('http://example.com');
        const done = await settled(scans, publicId);
        expect(done.checks.find((check) => check.checkId === 'https_scheme')).toMatchObject({ status: 'pass', evidence: { scheme: 'http', finalScheme: 'https' } });
    });

    it('replays only what was missed after Last-Event-ID', async () => {
        const { scans } = testContainer();
        const { publicId } = await scans.create('example.com');
        await settled(scans, publicId);
        const ids: string[] = [];
        for await (const event of scans.follow(publicId, String(LAST - 2), new AbortController().signal)) ids.push(event.id);
        expect(ids).toEqual([String(LAST - 1), String(LAST)]);
    });

    it('follows a running scan live and ends at the terminal event', async () => {
        const { scans } = testContainer({ SCAN_STEP_DELAY_MS: '20' });
        const { publicId } = await scans.create('example.com');
        const seen: string[] = [];
        for await (const event of scans.follow(publicId, undefined, new AbortController().signal)) seen.push(event.type);
        expect(seen.at(0)).toBe('scan.started');
        expect(seen.at(-1)).toBe('scan.completed');
    });

    it('ends at once for a reader that resumes after the terminal event, instead of waiting for ever', async () => {
        const { scans } = testContainer();
        const { publicId } = await scans.create('example.com');
        await settled(scans, publicId);
        for (const afterId of [String(LAST), String(LAST + 1)]) {
            const ids: string[] = [];
            for await (const event of scans.follow(publicId, afterId, new AbortController().signal)) ids.push(event.id);
            expect(ids).toEqual([]);
        }
    });

    it('leaves no abort listener behind on the signal of a reader it woke up', async () => {
        const { scans } = testContainer({ SCAN_STEP_DELAY_MS: '5' });
        const { publicId } = await scans.create('example.com');
        const signal = new AbortController().signal;
        let events = 0;
        for await (const _event of scans.follow(publicId, undefined, signal)) events += 1;
        expect(events).toBe(LAST);
        expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    });

    it('logs the cause of a scan that fails inside the job, and reports internal_error', async () => {
        const captured = captureLogs();
        const holder: { service: ScansService | undefined } = { service: undefined };
        const scans = createScansService({
            store: createInMemoryScanStore(),
            siteLog: createInMemorySiteLog(),
            blockedBy: () => undefined,
            queue: createInlineJobQueue(
                (job) => holder.service?.run(job) ?? Promise.resolve(),
                () => undefined,
            ),
            fetcher: { fetchPage: () => Promise.reject(new Error('fetcher exploded')), inspectCertificate: () => Promise.resolve(null), close: () => Promise.resolve() },
            ids: sequentialIds(),
            clock: { now: () => FIXED_TIME },
            logger: captured.logger,
            logClient: false,
            limiter: { hit: () => Promise.resolve({ allowed: true }) },
            limits: { perIp: 1, perDomain: 1, windowMs: 1000 },
            stepDelayMs: 0,
        });
        holder.service = scans;

        const { publicId } = await scans.create('example.com');
        const done = await settled(scans, publicId);
        expect(done).toMatchObject({ status: 'failed', failureReason: 'internal_error' });
        const errors = captured.lines().filter((line) => line['level'] === 'error');
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ msg: 'scan job failed', publicId, err: { message: 'fetcher exploded' } });
    });

    it.each([
        ['', 'EMPTY'],
        ['ftp://example.com', 'UNSUPPORTED_SCHEME'],
        ['localhost', 'HOST_NOT_ALLOWED'],
        ['https://user:pw@example.com', 'CREDENTIALS'],
    ])('rejects %j with VALIDATION_FAILED on the url field', async (input, reason) => {
        const { scans } = testContainer();
        await expect(scans.create(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'url', message: reason }] });
    });

    /** A service whose scans run inline, with the given fetcher, store and deadline. */
    const inlineService = (fetcher: SiteFetcher, logger: Logger, overrides: { store?: ScanStore; deadlineMs?: number } = {}) => {
        const holder: { service: ScansService | undefined } = { service: undefined };
        const scans = createScansService({
            store: overrides.store ?? createInMemoryScanStore(),
            siteLog: createInMemorySiteLog(),
            blockedBy: () => undefined,
            queue: createInlineJobQueue(
                (job) => holder.service?.run(job) ?? Promise.resolve(),
                () => undefined,
            ),
            fetcher,
            ids: sequentialIds(),
            clock: { now: () => FIXED_TIME },
            logger,
            logClient: false,
            limiter: { hit: () => Promise.resolve({ allowed: true }) },
            limits: { perIp: 1, perDomain: 1, windowMs: 1000 },
            stepDelayMs: 0,
            ...(overrides.deadlineMs === undefined ? {} : { deadlineMs: overrides.deadlineMs }),
        });
        holder.service = scans;
        return scans;
    };

    it('stops a scan past its deadline, aborts its fetches and fails it as timeout', async () => {
        const signals: AbortSignal[] = [];
        // A site that never answers: each fetch waits until it is aborted.
        const fetcher: SiteFetcher = {
            fetchPage: (_url, options) =>
                new Promise((resolve) => {
                    if (options?.signal !== undefined) signals.push(options.signal);
                    options?.signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'timeout' }), { once: true });
                }),
            inspectCertificate: () => Promise.resolve(null),
            close: () => Promise.resolve(),
        };
        const captured = captureLogs();
        const scans = inlineService(fetcher, captured.logger, { deadlineMs: 30 });
        const { publicId } = await scans.create('example.com');
        const done = await settled(scans, publicId);
        expect(done).toMatchObject({ status: 'failed', failureReason: 'timeout' });
        expect(signals.length).toBeGreaterThan(0);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(captured.lines().some((line) => line['msg'] === 'scan over its deadline, stopped')).toBe(true);
    });

    it('fails the job instead of swallowing it when the scan cannot be ended as failed', async () => {
        const store = createInMemoryScanStore();
        const broken: ScanStore = {
            ...store,
            publish: (publicId, draft, fold, derive) => (draft.type === 'scan.failed' ? Promise.reject(new Error('database away')) : store.publish(publicId, draft, fold, derive)),
        };
        const captured = captureLogs();
        const fetcher: SiteFetcher = { fetchPage: () => Promise.reject(new Error('fetcher exploded')), inspectCertificate: () => Promise.resolve(null), close: () => Promise.resolve() };
        const scans = inlineService(fetcher, captured.logger, { store: broken });
        const { publicId } = await scans.create('example.com');
        await expect(scans.run({ publicId, url: 'https://example.com/' })).rejects.toThrow('database away');
        expect(captured.lines().some((line) => line['level'] === 'error' && line['msg'] === 'ending the scan as failed did not work')).toBe(true);
    });

    it('reports an unknown scan as NOT_FOUND', async () => {
        const { scans } = testContainer();
        await expect(scans.get('x'.repeat(22))).rejects.toBeInstanceOf(AppError);
        await expect(scans.get('x'.repeat(22))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
});

describe('scans HTTP routes', () => {
    it('POST /v1/scans answers 201 with the public id and a snapshot, and asks search engines to stay away', async () => {
        const app = createApp(testContainer());
        const response = await post(app, { url: 'example.com' });
        expect(response.status).toBe(201);
        expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
        const body = createScanResponseSchema.parse(await response.json());
        expect(body.snapshot.publicId).toBe(body.publicId);
        expect(body.snapshot.status).toBe('running');
    });

    it('answers a repeated Idempotency-Key with the same scan, without spending the rate limit', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '2' }));
        const send = (url: string, key: string) => app.request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ url }) });
        const key = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab';
        // A double submit: both arrive before the first is answered.
        const [first, second] = await Promise.all([send('example.com', key), send('example.com', key)]);
        expect(first?.status).toBe(201);
        expect(second?.status).toBe(201);
        const firstId = createScanResponseSchema.parse(await first?.json()).publicId;
        expect(createScanResponseSchema.parse(await second?.json()).publicId).toBe(firstId);
        expect(createScanResponseSchema.parse(await (await send('example.com', key)).json()).publicId).toBe(firstId);
        // The same key for another address is another request; it is the second scan, so the limit of 2 still lets it through.
        const other = await send('example.org', key);
        expect(other.status).toBe(201);
        expect(createScanResponseSchema.parse(await other.json()).publicId).not.toBe(firstId);
        expect((await send('example.net', 'another-key-123')).status).toBe(429);
    });

    it('rejects an Idempotency-Key in the wrong shape', async () => {
        const response = await createApp(testContainer()).request('/v1/scans', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': 'short' },
            body: JSON.stringify({ url: 'example.com' }),
        });
        expect(response.status).toBe(400);
        expect(errorResponseSchema.parse(await response.json()).error.code).toBe('VALIDATION_FAILED');
    });

    it('forgets an Idempotency-Key after 10 minutes, and at once when the request was refused', async () => {
        const clock = { time: FIXED_TIME.getTime() };
        const { buildContainer } = await import('@composition/deps.ts');
        const { scans } = buildContainer(testConfig({ SCAN_LIMIT_PER_IP: '3', SCAN_LIMIT_WINDOW_MS: '60000' }), {
            clock: { now: () => new Date(clock.time) },
            ids: sequentialIds(),
            fetcher: fakeFetcher(),
        });
        // `fresh` throughout: this is about the key, not about handing out a recent scan of the same address.
        const first = await scans.create('example.com', '203.0.113.9', 'key-0000001', true);
        expect((await scans.create('example.com', '203.0.113.9', 'key-0000001', true)).publicId).toBe(first.publicId);
        // Another caller with the same key is another request.
        expect((await scans.create('example.com', '203.0.113.10', 'key-0000001', true)).publicId).not.toBe(first.publicId);
        await scans.create('example.org', '203.0.113.9', undefined, true);
        await scans.create('example.net', '203.0.113.9', undefined, true);
        // Refused: the caller's limit is used up. Once the window has passed, the same key starts the scan.
        await expect(scans.create('example.info', '203.0.113.9', 'key-0000002', true)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        clock.time += 60_000;
        await expect(scans.create('example.info', '203.0.113.9', 'key-0000002', true)).resolves.toMatchObject({ domain: 'example.info' });
        clock.time += 10 * 60_000;
        expect((await scans.create('example.com', '203.0.113.9', 'key-0000001', true)).publicId).not.toBe(first.publicId);
    });

    it('hands out a scan of the same address from the last 10 minutes, free of the rate limit, unless asked for a fresh one', async () => {
        const clock = { time: FIXED_TIME.getTime() };
        const { buildContainer } = await import('@composition/deps.ts');
        const { scans } = buildContainer(testConfig({ SCAN_LIMIT_PER_IP: '2' }), { clock: { now: () => new Date(clock.time) }, ids: sequentialIds(), fetcher: fakeFetcher() });
        const first = await scans.create('example.com', '203.0.113.9');
        // Another caller, and again: the same scan, and neither spends the limit.
        expect((await scans.create('https://example.com/', '203.0.113.10')).publicId).toBe(first.publicId);
        expect((await scans.create('example.com', '203.0.113.9')).publicId).toBe(first.publicId);
        // `fresh` scans anew, and counts.
        const fresh = await scans.create('example.com', '203.0.113.9', undefined, true);
        expect(fresh.publicId).not.toBe(first.publicId);
        await expect(scans.create('example.org', '203.0.113.9')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        // An address whose query values are hidden in the report is never matched: `?id=1` and `?id=2` look the same once stored.
        const query = await scans.create('example.net/?id=1', '203.0.113.11');
        expect((await scans.create('example.net/?id=1', '203.0.113.11')).publicId).not.toBe(query.publicId);
        // After 10 minutes the address is scanned anew.
        clock.time += 10 * 60_000 + 1;
        expect((await scans.create('example.com', '203.0.113.10')).publicId).not.toBe(fresh.publicId);
    });

    it('limits how often one caller is handed a recent scan, in a bucket far looser than the scan limit', async () => {
        const { buildContainer } = await import('@composition/deps.ts');
        const { scans } = buildContainer(testConfig({ SCAN_LIMIT_PER_IP: '1' }), { clock: { now: () => FIXED_TIME }, ids: sequentialIds(), fetcher: fakeFetcher() });
        const first = await scans.create('example.com', '203.0.113.20');
        // The scan itself took the one scan of the window; ten reuses of it remain (the reuse bucket counts the first request too).
        for (let reuse = 0; reuse < 9; reuse += 1) expect((await scans.create('example.com', '203.0.113.20')).publicId).toBe(first.publicId);
        await expect(scans.create('example.com', '203.0.113.20')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        // Another caller has its own bucket.
        expect((await scans.create('example.com', '203.0.113.21')).publicId).toBe(first.publicId);
    });

    it('matches an Idempotency-Key by the normalized address, not by the text typed', async () => {
        const { scans } = testContainer();
        const first = await scans.create('Example.com', '203.0.113.30', 'key-0000003', true);
        expect((await scans.create('https://example.com/', '203.0.113.30', 'key-0000003', true)).publicId).toBe(first.publicId);
    });

    it('rejects an address that cannot be scanned with the field named', async () => {
        const response = await post(createApp(testContainer()), { url: 'http://127.0.0.1/admin' });
        expect(response.status).toBe(400);
        const body = errorResponseSchema.parse(await response.json());
        expect(body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'url', message: 'HOST_NOT_ALLOWED' }] });
    });

    it('rejects malformed JSON and a missing url as VALIDATION_FAILED, not as a server error', async () => {
        const app = createApp(testContainer());
        for (const response of [await post(app, undefined, '{not json'), await post(app, {}), await post(app, { url: 123 })]) {
            expect(response.status).toBe(400);
            expect(errorResponseSchema.parse(await response.json()).error.code).toBe('VALIDATION_FAILED');
        }
    });

    it('refuses a body that is far too large before reading it', async () => {
        const response = await post(createApp(testContainer()), { url: 'example.com', padding: 'x'.repeat(40_000) });
        expect(response.status).toBe(400);
        expect(errorResponseSchema.parse(await response.json()).error.code).toBe('VALIDATION_FAILED');
    });

    it('GET /v1/scans/:publicId returns the snapshot and is never cached', async () => {
        const container = testContainer();
        const app = createApp(container);
        const created = createScanResponseSchema.parse(await (await post(app, { url: 'example.com' })).json());
        await settled(container.scans, created.publicId);

        const response = await app.request(`/v1/scans/${created.publicId}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
        expect(scanSnapshotSchema.parse(await response.json())).toMatchObject({ status: 'completed', score: 100 });
    });

    it('answers an unknown id with NOT_FOUND and a malformed id with VALIDATION_FAILED', async () => {
        const app = createApp(testContainer());
        const unknown = await app.request(`/v1/scans/${'x'.repeat(22)}`);
        expect(unknown.status).toBe(404);
        const malformed = await app.request('/v1/scans/short');
        expect(malformed.status).toBe(400);
    });

    it('streams the events with ids, resumes after Last-Event-ID, and answers 404 before streaming for an unknown id', async () => {
        const container = testContainer();
        const app = createApp(container);
        const { publicId } = createScanResponseSchema.parse(await (await post(app, { url: 'example.com' })).json());
        await settled(container.scans, publicId);

        const full = await app.request(`/v1/scans/${publicId}/events`);
        expect(full.headers.get('content-type')).toContain('text/event-stream');
        const { messages } = parseSse(await full.text());
        expect(messages.map((message) => message.id)).toEqual(Array.from({ length: LAST }, (_, index) => String(index + 1)));
        for (const message of messages) expect(scanEventSchema.safeParse(JSON.parse(message.data ?? '{}')).success).toBe(true);

        const resumed = await app.request(`/v1/scans/${publicId}/events`, { headers: { 'last-event-id': String(LAST - 2) } });
        expect(parseSse(await resumed.text()).messages.map((message) => message.id)).toEqual([String(LAST - 1), String(LAST)]);

        const unknown = await app.request(`/v1/scans/${'x'.repeat(22)}/events`);
        expect(unknown.status).toBe(404);
        expect(unknown.headers.get('content-type')).toContain('application/json');
    });
});

describe('scans service: what is kept of the address', () => {
    const service = (fetcher = fakeFetcher()) => {
        const siteLog = createInMemorySiteLog();
        const holder: { service: ScansService | undefined } = { service: undefined };
        const scans = createScansService({
            store: createInMemoryScanStore(),
            siteLog,
            blockedBy: () => undefined,
            queue: createInlineJobQueue(
                (job) => holder.service?.run(job) ?? Promise.resolve(),
                () => undefined,
            ),
            fetcher,
            ids: sequentialIds(),
            clock: { now: () => FIXED_TIME },
            logger: captureLogs().logger,
            logClient: false,
            limiter: { hit: async () => ({ allowed: true }) },
            limits: { perIp: 1, perDomain: 1, windowMs: 1000 },
            stepDelayMs: 0,
        });
        holder.service = scans;
        return { scans, siteLog };
    };

    it('stores the query keys without their values, and still fetches the address as typed', async () => {
        const fetcher = fakeFetcher();
        const { scans } = service(fetcher);
        const created = await scans.create('example.com/reset?token=s3cret&lang=en&debug');
        expect(created.url).toBe('https://example.com/reset?token=…&lang=…&debug');
        const done = await settled(scans, created.publicId);
        expect(JSON.stringify(done)).not.toContain('s3cret');
        expect(fetcher.requested).toContain('https://example.com/reset?token=s3cret&lang=en&debug');
    });

    it('records the registrable domain in the list of sites, not each made-up subdomain', async () => {
        const { scans, siteLog } = service();
        await settled(scans, (await scans.create('a1.example.co.uk')).publicId);
        await settled(scans, (await scans.create('b2.example.co.uk')).publicId);
        expect((await siteLog.list()).map((site) => [site.domain, site.scanCount, site.lastScore])).toEqual([['example.co.uk', 2, 100]]);
    });

    it('counts every request for a domain, scans only when a scan starts, and the rate limit as a request too', async () => {
        const siteLog = createInMemorySiteLog();
        const holder: { service: ScansService | undefined } = { service: undefined };
        const scans = createScansService({
            store: createInMemoryScanStore(),
            siteLog,
            blockedBy: () => undefined,
            queue: createInlineJobQueue(
                (job) => holder.service?.run(job) ?? Promise.resolve(),
                () => undefined,
            ),
            fetcher: fakeFetcher(),
            ids: sequentialIds(),
            clock: { now: () => FIXED_TIME },
            logger: captureLogs().logger,
            logClient: false,
            limiter: createRateLimiter({ now: () => FIXED_TIME }),
            limits: { perIp: 2, perDomain: 100, windowMs: 60_000 },
            reuseMs: 600_000,
            stepDelayMs: 0,
        });
        holder.service = scans;
        await scans.create('counted.example', '203.0.113.9');
        // Handed the same recent scan: a request, not a scan, and no limit spent.
        await scans.create('counted.example', '203.0.113.10');
        await scans.create('counted.example', '203.0.113.9', undefined, true);
        // The caller's limit is used up: refused, still a request.
        await expect(scans.create('counted.example', '203.0.113.9', undefined, true)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        expect((await siteLog.list()).find((site) => site.domain === 'counted.example')).toMatchObject({ requestCount: 4, scanCount: 2, blockedCount: 0 });
    });

    it('hides query values', () => {
        expect(hideQueryValues('https://x.com/')).toBe('https://x.com/');
        expect(hideQueryValues('https://x.com/p?a=1&b=&c&a=2')).toBe('https://x.com/p?a=…&b=…&c&a=…');
    });
});

describe('scans service: fetching the scanned site', () => {
    it('fetches the normalized URL exactly once and hands the page to the checks', async () => {
        const fetcher = fakeFetcher({ ok: true, page: cannedPage({ status: 500 }) });
        const { scans } = testContainer({}, fetcher);
        const { publicId } = await scans.create('HTTPS://Example.COM/path#frag');
        const done = await settled(scans, publicId);

        // The page is fetched once, and once more as an agent would ask for it (Markdown); the plain-http entry point once, and the files around the page are looked up on the scanned host.
        expect(fetcher.requested.filter((url) => url.endsWith('/path'))).toEqual(['https://example.com/path', 'https://example.com/path']);
        expect(fetcher.requested).toEqual(
            expect.arrayContaining(['http://example.com/', 'https://example.com/robots.txt', 'https://example.com/llms.txt', 'https://example.com/sitemap.xml', 'https://www.example.com/']),
        );
        expect(fetcher.requested.every((url) => new URL(url).host.replace(/^www\./, '') === 'example.com')).toBe(true);
        expect(done.checks.find((check) => check.checkId === 'http_status')).toMatchObject({ status: 'fail', evidence: { status: 500, redirects: 0 } });
        // A failed page is a critical failure: the HP is held at the cap.
        expect(done.score).toBe(CRITICAL_CAP);
    });

    it.each(['blocked_address', 'unreachable', 'timeout', 'too_many_redirects', 'invalid_response'] as const)('ends the scan with the reason when the fetch fails: %s', async (reason) => {
        const { scans } = testContainer({}, fakeFetcher({ ok: false, reason }));
        const { publicId } = await scans.create('example.com');
        const done = await settled(scans, publicId);

        expect(done).toMatchObject({ status: 'failed', failureReason: reason, preliminary: false, checks: [], score: null });

        const types: string[] = [];
        for await (const event of scans.follow(publicId, undefined, new AbortController().signal)) types.push(event.type);
        expect(types).toEqual(['scan.started', 'scan.failed']);
    });

    it('reports a bad certificate as a finding and goes on without a page, instead of ending the scan', async () => {
        const certificate = { authorized: false, error: 'CERT_HAS_EXPIRED', validTo: '2020-01-01T00:00:00.000Z', daysLeft: -2000, issuer: 'Test CA' };
        const { scans } = testContainer({}, fakeFetcher({ ok: false, reason: 'tls_error' }, certificate));
        const { publicId } = await scans.create('example.com');
        const done = await settled(scans, publicId);

        expect(done).toMatchObject({ status: 'completed', responseHeaders: null });
        expect(done.checks.find((check) => check.checkId === 'cert_valid')).toMatchObject({ status: 'fail', evidence: { authorized: false, error: 'CERT_HAS_EXPIRED' } });
        expect(done.checks.find((check) => check.checkId === 'cert_expiry')).toMatchObject({ status: 'fail' });
        // What needs the page is reported as not checked, never as a pass.
        expect(done.checks.find((check) => check.checkId === 'hsts')).toMatchObject({ status: 'skipped' });
    });

    it('reads the certificate of the host the page ended on over https, and of the typed host otherwise', async () => {
        const hostsOf = async (finalUrl: string): Promise<string[]> => {
            const hosts: string[] = [];
            const fetcher = fakeFetcher({ ok: true, page: cannedPage({ finalUrl }) });
            const { scans } = testContainer({}, { ...fetcher, inspectCertificate: (host) => (hosts.push(host), Promise.resolve(goodCertificate)) });
            await settled(scans, (await scans.create('http://example.com')).publicId);
            return hosts;
        };
        expect(await hostsOf('https://www.example.com/')).toEqual(['www.example.com']);
        expect(await hostsOf('http://www.example.com/')).toEqual(['example.com']);
    });

    it('falls back to http once for an address typed without a scheme whose https does not answer, and reports the address scanned', async () => {
        const httpsDown = (reason: 'unreachable' | 'tls_error' | 'timeout'): SiteFetcher & { requested: string[] } => {
            const base = fakeFetcher({ ok: true, page: cannedPage({ finalUrl: 'http://example.com/page' }) });
            return {
                ...base,
                fetchPage: (url, options) => (url.startsWith('https:') ? (base.requested.push(url), Promise.resolve({ ok: false, reason })) : base.fetchPage(url, options)),
            };
        };

        const fetcher = httpsDown('unreachable');
        const { scans } = testContainer({}, fetcher);
        const { publicId } = await scans.create('example.com/page');
        const done = await settled(scans, publicId);
        expect(done).toMatchObject({ status: 'completed', url: 'http://example.com/page' });
        expect(fetcher.requested).toEqual(expect.arrayContaining(['https://example.com/page', 'http://example.com/page', 'http://example.com/robots.txt']));
        expect(done.checks.find((check) => check.checkId === 'https_scheme')).toMatchObject({ status: 'fail' });

        // A broken handshake counts as https not answering, too.
        const tls = testContainer({}, httpsDown('tls_error')).scans;
        expect(await settled(tls, (await tls.create('example.com/page')).publicId)).toMatchObject({ status: 'completed', url: 'http://example.com/page' });

        // Typed with https, it stays https; a timeout is not "https does not answer at all".
        for (const [input, reason] of [
            ['https://example.com/page', 'unreachable'],
            ['example.com/page', 'timeout'],
        ] as const) {
            const strict = httpsDown(reason);
            const container = testContainer({}, strict);
            expect(await settled(container.scans, (await container.scans.create(input)).publicId)).toMatchObject({ status: 'failed', failureReason: reason, url: 'https://example.com/page' });
            expect(strict.requested, input).not.toContain('http://example.com/page');
        }
    });

    it('never fetches an address that is refused up front', async () => {
        const fetcher = fakeFetcher();
        const { scans } = testContainer({}, fetcher);
        await expect(scans.create('http://127.0.0.1/admin')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(fetcher.requested).toEqual([]);
    });
});

describe('in-memory scan store', () => {
    const base = () => emptySnapshot({ publicId: 'x'.repeat(22), url: 'https://example.com/', domain: 'example.com', createdAt: FIXED_TIME.toISOString(), totalChecks: 3 });
    const started = { type: 'scan.started', ts: FIXED_TIME.toISOString(), data: { url: 'https://example.com/', domain: 'example.com', totalChecks: 3 } } as const;

    it('appends the event and folds it into the snapshot in one step', async () => {
        const store = createInMemoryScanStore();
        await store.create(base());
        const { event, snapshot } = await store.publish('x'.repeat(22), started, reduceScan);
        expect(event.id).toBe('1');
        expect(snapshot.lastEventId).toBe('1');
        expect(await store.get('x'.repeat(22))).toEqual(snapshot);
    });

    it('changes neither the log nor the snapshot when folding fails', async () => {
        const store = createInMemoryScanStore();
        await store.create(base());
        await expect(
            store.publish('x'.repeat(22), started, () => {
                throw new Error('fold failed');
            }),
        ).rejects.toThrow('fold failed');

        expect(await store.get('x'.repeat(22))).toEqual(base());
        // The next event still gets id 1: nothing was appended.
        expect((await store.publish('x'.repeat(22), started, reduceScan)).event.id).toBe('1');
    });
});

describe('in-memory scan store: retention', () => {
    const at = { time: 0 };
    const clock = { now: () => new Date(at.time) };
    const id = (n: number) => `scan-${String(n).padStart(17, '0')}`;
    const snapshot = (n: number) => emptySnapshot({ publicId: id(n), url: 'https://example.com/', domain: 'example.com', createdAt: FIXED_TIME.toISOString(), totalChecks: 3 });
    const finish = (store: ReturnType<typeof createInMemoryScanStore>, n: number) =>
        store.publish(id(n), { type: 'scan.failed', ts: FIXED_TIME.toISOString(), data: { reason: 'unreachable' } }, reduceScan);

    it('forgets a finished scan after the retention, and keeps a running one', async () => {
        at.time = 0;
        const store = createInMemoryScanStore({ clock, ttlMs: 1000, maxScans: 100 });
        await store.create(snapshot(1));
        await store.create(snapshot(2));
        await finish(store, 1);
        at.time = 1000;
        await store.create(snapshot(3));
        expect(await store.get(id(1))).toBeUndefined();
        expect(await store.get(id(2))).toBeDefined();
    });

    it('above the cap drops the oldest finished scans first, and a running one only when nothing else is left', async () => {
        at.time = 0;
        const store = createInMemoryScanStore({ clock, ttlMs: 1_000_000, maxScans: 3 });
        for (const n of [1, 2, 3]) await store.create(snapshot(n));
        await finish(store, 2);
        await store.create(snapshot(4));
        expect(await store.get(id(2))).toBeUndefined();
        expect(await store.get(id(1))).toBeDefined();
        await store.create(snapshot(5));
        expect(await store.get(id(1))).toBeUndefined();
        expect(await store.get(id(3))).toBeDefined();
    });

    it('ends a follower of a scan that was dropped instead of leaving it waiting', async () => {
        at.time = 0;
        const store = createInMemoryScanStore({ clock, ttlMs: 1_000_000, maxScans: 1 });
        await store.create(snapshot(1));
        const reading = (async () => {
            for await (const _event of store.follow(id(1), undefined, new AbortController().signal)) void _event;
        })();
        await store.create(snapshot(2));
        await expect(reading).resolves.toBeUndefined();
    });
});

describe('inline job queue', () => {
    it('runs at most `concurrency` jobs at once; the next one starts when one finishes', async () => {
        const started: string[] = [];
        const finishers: Array<() => void> = [];
        const queue = createInlineJobQueue(
            (job) =>
                new Promise<void>((resolve) => {
                    started.push(job.publicId);
                    finishers.push(resolve);
                }),
            () => undefined,
            8,
        );
        for (let n = 1; n <= 9; n += 1) await queue.enqueue({ publicId: String(n) });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(started).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);

        finishers[0]?.();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(started).toHaveLength(9);
        expect(started.at(-1)).toBe('9');
    });
});

describe('shutdown', () => {
    it('ends an open event stream when the container closes', async () => {
        const container = testContainer({ SCAN_STEP_DELAY_MS: '10000' });
        const app = createApp(container);
        const { publicId } = await container.scans.create('example.com');

        const response = await app.request(`/v1/scans/${publicId}/events`);
        const body = response.text();
        await container.close();

        const { messages } = parseSse(await body);
        expect(messages.map((message) => message.event)).toEqual(['scan.started']);
    });

    it('closes the site fetcher', async () => {
        let closed = false;
        const container = testContainer(
            {},
            { fetchPage: () => Promise.resolve({ ok: false, reason: 'unreachable' }), inspectCertificate: () => Promise.resolve(null), close: () => Promise.resolve(void (closed = true)) },
        );
        await container.close();
        expect(closed).toBe(true);
    });
});
