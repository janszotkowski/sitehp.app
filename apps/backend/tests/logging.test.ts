import { CHECK_IDS } from '@sitehp.app/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '@composition/app.ts';
import { captureLogs, fakeFetcher, testContainer } from '@tests/helpers.ts';

const settled = async (container: ReturnType<typeof testContainer>, publicId: string) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
        if ((await container.scans.get(publicId)).status !== 'running') return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('the scan never finished');
};

const named = (lines: Array<Record<string, unknown>>, msg: string) => lines.filter((line) => line['msg'] === msg);

describe('the log of a scan', () => {
    const scan = async (settings: Record<string, string> = {}, input = 'https://example.com/pricing?token=SECRET123#frag', client?: string) => {
        const captured = captureLogs();
        const container = testContainer(settings, fakeFetcher(), undefined, captured.logger);
        const { publicId } = await container.scans.create(input, client);
        await settled(container, publicId);
        return { ...captured, publicId };
    };

    it('tells the whole story of a scan: created, started, the site contacted, every check, completed', async () => {
        const { lines, publicId } = await scan();
        const all = lines();
        expect(named(all, 'scan created')[0]).toMatchObject({ publicId, host: 'example.com', pathLength: 8, hasQuery: true, totalChecks: CHECK_IDS.length });
        expect(named(all, 'scan started')[0]).toMatchObject({ publicId, domain: 'example.com', queueWaitMs: expect.any(Number) });
        expect(named(all, 'site contacted')[0]).toMatchObject({
            publicId,
            page: { status: 200, redirects: 0, contentType: expect.stringContaining('html') },
            httpEntry: { status: 200 },
            certificate: { authorized: true, daysLeft: 90 },
            files: { robots: 200, sitemap: 200, llms: 200, notFound: 404 },
        });
        // One line per check at debug, with its verdict and how long it took.
        const checks = named(all, 'check completed');
        expect(checks.map((line) => line['checkId'])).toEqual([...CHECK_IDS]);
        expect(checks[0]).toMatchObject({ publicId, status: expect.any(String), severity: expect.any(String), pointsLost: expect.any(Number), durationMs: expect.any(Number) });
        // And one line for the end, with what needs a look.
        expect(named(all, 'scan completed')[0]).toMatchObject({
            publicId,
            domain: 'example.com',
            score: expect.any(Number),
            scoreCapped: false,
            categories: { security: expect.any(Number), seo: expect.any(Number), agent: expect.any(Number) },
            checks: { pass: expect.any(Number), warn: expect.any(Number), fail: expect.any(Number), skipped: expect.any(Number) },
            failed: expect.any(Array),
            durationMs: expect.any(Number),
        });
        // Every event of the scan is traced with its id.
        const events = named(all, 'event published');
        expect(events).toHaveLength(1 + 1 + CHECK_IDS.length * 2 + 1);
        expect(events.at(-1)).toMatchObject({ type: 'scan.completed', eventId: String(events.length) });
    });

    it('never writes a query string, a fragment or the typed input into a log, at any level', async () => {
        const { text } = await scan();
        for (const secret of ['SECRET123', 'token=', 'frag']) expect(text()).not.toContain(secret);
    });

    it('leaves the caller out unless LOG_CLIENT_IP is on', async () => {
        expect((await scan({}, 'example.com', '203.0.113.9')).text()).not.toContain('203.0.113.9');
        const { lines } = await scan({ LOG_CLIENT_IP: 'true' }, 'example.com', '203.0.113.9');
        expect(named(lines(), 'scan created')[0]).toMatchObject({ client: '203.0.113.9' });
    });

    it('says why a scan was refused, without logging what was typed', async () => {
        const captured = captureLogs();
        const container = testContainer({ SCAN_LIMIT_PER_DOMAIN: '1' }, fakeFetcher(), undefined, captured.logger);
        await expect(container.scans.create('ftp://secret-host.example/x?token=SECRET123')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(container.scans.create('shop.example.ru')).rejects.toMatchObject({ code: 'DOMAIN_BLOCKED' });
        await container.scans.create('limited.example', '203.0.113.9');
        await expect(container.scans.create('limited.example', '203.0.113.10', undefined, true)).rejects.toMatchObject({ code: 'RATE_LIMITED' });

        const refused = named(captured.lines(), 'scan refused');
        expect(refused).toMatchObject([
            { level: 'info', reason: 'invalid_url', rejection: 'UNSUPPORTED_SCHEME', length: expect.any(Number) },
            { level: 'warn', reason: 'domain_blocked', domain: 'shop.example.ru' },
            { level: 'warn', reason: 'rate_limited', limit: 'domain', domain: 'limited.example', retryAfterSec: expect.any(Number) },
        ]);
        expect(captured.text()).not.toContain('SECRET123');
        expect(captured.text()).not.toContain('secret-host');
    });

    it('logs a scan that could not reach the site with its reason', async () => {
        const captured = captureLogs();
        const container = testContainer({}, fakeFetcher({ ok: false, reason: 'unreachable' }), undefined, captured.logger);
        const { publicId } = await container.scans.create('down.example');
        await settled(container, publicId);
        expect(named(captured.lines(), 'scan failed')[0]).toMatchObject({ level: 'warn', publicId, domain: 'down.example', reason: 'unreachable', durationMs: expect.any(Number) });
    });
});

describe('the access log', () => {
    const post = (app: ReturnType<typeof createApp>, url: string, headers: Record<string, string> = {}) =>
        app.request('/v1/scans', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'TestAgent/1.0', origin: 'http://localhost:3000', ...headers },
            body: JSON.stringify({ url }),
        });

    it('records the route, the user agent, the origin and the API error code of a refused request', async () => {
        const captured = captureLogs();
        const app = createApp(testContainer({}, fakeFetcher(), undefined, captured.logger));
        await post(app, 'baidu.cn');
        expect(named(captured.lines(), 'request')[0]).toMatchObject({
            method: 'POST',
            path: '/v1/scans',
            route: '/v1/scans',
            status: 403,
            errorCode: 'DOMAIN_BLOCKED',
            userAgent: 'TestAgent/1.0',
            origin: 'http://localhost:3000',
            requestId: expect.any(String),
        });
    });

    it('has no error code on a success and no caller address unless LOG_CLIENT_IP is on', async () => {
        const captured = captureLogs();
        const app = createApp(testContainer({}, fakeFetcher(), undefined, captured.logger));
        await post(app, 'example.com');
        const entry = named(captured.lines(), 'request')[0];
        expect(entry).toMatchObject({ status: 201 });
        expect(entry).not.toHaveProperty('errorCode');
        expect(entry).not.toHaveProperty('client');
        expect(entry).not.toHaveProperty('forwardedFor');
    });

    it('with LOG_CLIENT_IP on, logs the raw X-Forwarded-For and X-Real-IP next to the client it was turned into', async () => {
        const captured = captureLogs();
        const app = createApp(testContainer({ LOG_CLIENT_IP: 'true' }, fakeFetcher(), undefined, captured.logger));
        await app.request('/v1/health', { headers: { 'X-Forwarded-For': '1.2.3.4, 5.6.7.8', 'X-Real-IP': '5.6.7.8' } });
        expect(named(captured.lines(), 'request')[0]).toMatchObject({ client: expect.any(String), forwardedFor: '1.2.3.4, 5.6.7.8', realIp: '5.6.7.8' });
    });

    it('keeps only the first 4 characters of a report id in the logged path: the id is what lets one read the report', async () => {
        const captured = captureLogs();
        const container = testContainer({}, fakeFetcher(), undefined, captured.logger);
        const app = createApp(container);
        const { publicId } = await container.scans.create('example.com');
        await settled(container, publicId);
        await app.request(`/v1/scans/${publicId}`);
        await (await app.request(`/v1/scans/${publicId}/events`)).text();
        const paths = named(captured.lines(), 'request').map((line) => line['path']);
        expect(paths).toEqual([`/v1/scans/${publicId.slice(0, 4)}…`, `/v1/scans/${publicId.slice(0, 4)}…/events`]);
        expect(JSON.stringify(named(captured.lines(), 'request'))).not.toContain(publicId);
    });

    it('logs a stream when it opens, with where it resumes from', async () => {
        const captured = captureLogs();
        const container = testContainer({}, fakeFetcher(), undefined, captured.logger);
        const app = createApp(container);
        const { publicId } = await container.scans.create('example.com');
        await settled(container, publicId);
        await (await app.request(`/v1/scans/${publicId}/events`, { headers: { 'last-event-id': '3' } })).text();
        expect(named(captured.lines(), 'stream opened')[0]).toMatchObject({ publicId, resumeFrom: '3', openFromCaller: 1 });
        await (await app.request(`/v1/scans/${publicId}/events`, { headers: { 'last-event-id': 'x'.repeat(5000) } })).text();
        expect(named(captured.lines(), 'stream opened')[1]).toMatchObject({ resumeFrom: '(invalid)' });
    });

    it('gives a refusal no route answered its error code, no route, and cuts what the caller sent short', async () => {
        const captured = captureLogs();
        const app = createApp(testContainer({}, fakeFetcher(), undefined, captured.logger));
        await app.request(`/${'a'.repeat(5000)}`, { headers: { origin: `http://${'o'.repeat(5000)}` } });
        await app.request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'x'.repeat(20_000) }) });
        const [missing, tooLarge] = named(captured.lines(), 'request');
        expect(missing).toMatchObject({ status: 404, errorCode: 'NOT_FOUND', route: null });
        expect(String(missing?.['path']).length).toBe(200);
        expect(String(missing?.['origin']).length).toBe(200);
        expect(tooLarge).toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED', route: null });
    });
});
