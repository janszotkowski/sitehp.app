import { createScanResponseSchema, errorResponseSchema, scanSnapshotSchema } from '@sitehp.app/core';
import { createApp } from '@composition/app.ts';
import { buildContainer, type ContainerOverrides } from '@composition/deps.ts';
import { callerKey } from '@platform/net/ip.ts';
import { createRateLimiter } from '@platform/rate-limit.ts';
import { describe, expect, it, vi } from 'vitest';
import { captureLogs, fakeFetcher, FIXED_TIME, testConfig, testContainer } from '@tests/helpers.ts';

describe('the rate limiter', () => {
    const at = { time: 0 };
    const limiter = createRateLimiter({ now: () => new Date(at.time) });

    const one = (key: string, limit = 2) => limiter.hit([{ key, limit }], 10_000);

    it('allows up to the limit, then says when to come back', async () => {
        at.time = 1_000;
        expect(await one('k')).toEqual({ allowed: true });
        expect(await one('k')).toEqual({ allowed: true });
        at.time = 4_000;
        expect(await one('k')).toEqual({ allowed: false, key: 'k', retryAfterSec: 7 });
    });

    it('keeps keys apart and opens a new window when the old one is over', async () => {
        expect(await one('other')).toEqual({ allowed: true });
        at.time = 11_000;
        expect(await one('k')).toEqual({ allowed: true });
    });

    it('counts a hit on every key or on none: a refusal by one key does not use up the others', async () => {
        const fresh = createRateLimiter({ now: () => new Date(0) });
        expect(await fresh.hit([{ key: 'full', limit: 1 }], 10_000)).toEqual({ allowed: true });
        for (let i = 0; i < 3; i += 1)
            expect(
                await fresh.hit(
                    [
                        { key: 'caller', limit: 1 },
                        { key: 'full', limit: 1 },
                    ],
                    10_000,
                ),
            ).toMatchObject({ allowed: false, key: 'full' });
        expect(await fresh.hit([{ key: 'caller', limit: 1 }], 10_000)).toEqual({ allowed: true });
    });
});

describe('which rate limiter a container uses', () => {
    // `fresh`: the same address again would be handed the recent scan instead of counting.
    const post = (app: ReturnType<typeof createApp>) =>
        app.request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'example.com', fresh: true }) });

    it('counts in Redis when Redis is configured: its answer decides', async () => {
        const calls: unknown[][] = [];
        // The script's answer for "the first key is full, 2.5 s left".
        const redis = {
            eval: (...args: unknown[]) => {
                calls.push(args);
                return Promise.resolve([1, 2500]);
            },
            ping: () => Promise.resolve('PONG'),
        };
        const container = buildContainer(testConfig(), { clock: { now: () => FIXED_TIME }, fetcher: fakeFetcher(), redis: redis as unknown as NonNullable<ContainerOverrides['redis']> });
        const refused = await post(createApp(container));
        expect(refused.status).toBe(429);
        expect(refused.headers.get('retry-after')).toBe('3');
        expect(calls[0]?.slice(1, 4)).toEqual([2, 'sitehp:rate:ip:unknown', 'sitehp:rate:domain:example.com']);
    });

    it('counts in memory without Redis', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '1' }));
        expect((await post(app)).status).toBe(201);
        expect((await post(app)).status).toBe(429);
    });
});

describe('callerKey', () => {
    it.each([
        ['1.2.3.4', '1.2.3.4'],
        ['2001:db8:1:2:aaaa::1', '2001:db8:1:2::/64'],
        ['2001:db8:1:2:bbbb:cccc:dddd:eeee', '2001:db8:1:2::/64'],
        ['::ffff:5.6.7.8', '5.6.7.8'],
        ['unknown', 'unknown'],
    ])('counts %s as %s', (address, key) => {
        expect(callerKey(address)).toBe(key);
    });
});

describe('X-Forwarded-For without a trusted proxy', () => {
    it('is ignored, and said once in the log, not on every request', async () => {
        const captured = captureLogs();
        const app = createApp(testContainer({}, undefined, undefined, captured.logger));
        for (let n = 0; n < 3; n += 1)
            await app.request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.1.1.1' }, body: JSON.stringify({ url: `site${n}.example.com` }) });
        const warnings = captured.lines().filter((line) => typeof line['msg'] === 'string' && line['msg'].includes('X-Forwarded-For'));
        expect(warnings).toHaveLength(1);
    });
});

describe('rate limiting of POST /v1/scans', () => {
    // Every request comes from our proxy at 10.0.0.1, unless a test says otherwise.
    const behindProxy = { TRUSTED_PROXY_HOPS: '1', TRUSTED_PROXY_CIDRS: '10.0.0.0/8' };
    const post = (app: ReturnType<typeof createApp>, url: string, headers: Record<string, string> = {}, peer = '10.0.0.1') =>
        app.request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ url }) }, { incoming: { socket: { remoteAddress: peer } } });

    it('refuses an address that starts too many scans with RATE_LIMITED and Retry-After, and still serves others', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '2', SCAN_LIMIT_PER_DOMAIN: '100', ...behindProxy }));
        const from = (ip: string) => ({ 'x-forwarded-for': ip });

        expect((await post(app, 'a.example.com', from('1.1.1.1'))).status).toBe(201);
        expect((await post(app, 'b.example.com', from('1.1.1.1'))).status).toBe(201);
        const refused = await post(app, 'c.example.com', from('1.1.1.1'));
        expect(refused.status).toBe(429);
        expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);
        expect(errorResponseSchema.parse(await refused.json()).error.code).toBe('RATE_LIMITED');

        expect((await post(app, 'c.example.com', from('2.2.2.2'))).status).toBe(201);
    });

    it('limits one domain across callers, with a different message', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '100', SCAN_LIMIT_PER_DOMAIN: '2', ...behindProxy }));
        for (const ip of ['1.1.1.1', '2.2.2.2']) expect((await post(app, `busy.example.com/${ip}`, { 'x-forwarded-for': ip })).status).toBe(201);
        const refused = await post(app, 'other.busy.example.com', { 'x-forwarded-for': '3.3.3.3' });
        expect(refused.status).toBe(429);
        expect(errorResponseSchema.parse(await refused.json()).error.message).toContain('This site');
        expect((await post(app, 'quiet.example.org', { 'x-forwarded-for': '3.3.3.3' })).status).toBe(201);
    });

    it('trusts only the entry our own proxy appended, so a forged address does not buy a fresh limit', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '1', SCAN_LIMIT_PER_DOMAIN: '100', ...behindProxy }));
        expect((await post(app, 'a.example.com', { 'x-forwarded-for': 'forged-1, 9.9.9.9' })).status).toBe(201);
        expect((await post(app, 'b.example.com', { 'x-forwarded-for': 'forged-2, 9.9.9.9' })).status).toBe(429);
    });

    it('counts a whole IPv6 /64 as one caller', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '1', SCAN_LIMIT_PER_DOMAIN: '100', ...behindProxy }));
        expect((await post(app, 'a.example.com', { 'x-forwarded-for': '2a00:1:2:3::1' })).status).toBe(201);
        expect((await post(app, 'b.example.com', { 'x-forwarded-for': '2a00:1:2:3::2' })).status).toBe(429);
        expect((await post(app, 'b.example.com', { 'x-forwarded-for': '2a00:1:2:4::1' })).status).toBe(201);
    });

    it("does not use up the caller's own limit when the domain refuses", async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '2', SCAN_LIMIT_PER_DOMAIN: '1', ...behindProxy }));
        expect((await post(app, 'busy.example.com', { 'x-forwarded-for': '1.1.1.1' })).status).toBe(201);
        expect((await post(app, 'busy.example.com/other', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(429);
        expect((await post(app, 'a.example.org', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(201);
        expect((await post(app, 'b.example.net', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(201);
    });

    it('trusts X-Forwarded-For only from a peer in TRUSTED_PROXY_CIDRS: anyone else cannot forge it, a private address included', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '1', SCAN_LIMIT_PER_DOMAIN: '100', ...behindProxy }));
        const via = (peer: string, forwarded: string, url: string) => post(app, url, { 'x-forwarded-for': forwarded }, peer);

        expect((await via('8.8.8.8', '1.1.1.1', 'a.example.com')).status).toBe(201);
        expect((await via('8.8.8.8', '2.2.2.2', 'b.example.com')).status).toBe(429);
        expect((await via('192.168.1.5', '3.3.3.3', 'c.example.com')).status).toBe(201);
        expect((await via('192.168.1.5', '4.4.4.4', 'd.example.com')).status).toBe(429);
        expect((await via('10.0.0.2', '5.5.5.5', 'e.example.com')).status).toBe(201);
        expect((await via('::ffff:10.0.0.3', '6.6.6.6', 'f.example.com')).status).toBe(201);
    });

    it('counts an IPv6 /48 as well, with a looser limit, so a holder of 65,536 /64s does not get 65,536 limits', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '1', SCAN_LIMIT_PER_DOMAIN: '100', ...behindProxy }));
        for (let i = 0; i < 10; i += 1) expect((await post(app, `s${i}.example.com`, { 'x-forwarded-for': `2a00:1:2:${i}::1` })).status).toBe(201);
        expect((await post(app, 'x.example.com', { 'x-forwarded-for': '2a00:1:2:ff::1' })).status).toBe(429);
        expect((await post(app, 'x.example.com', { 'x-forwarded-for': '2a00:1:3:ff::1' })).status).toBe(201);
    });

    it('counts subdomains against their registrable domain, but sites under a public suffix such as github.io apart', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '100', SCAN_LIMIT_PER_DOMAIN: '1', ...behindProxy }));
        expect((await post(app, 'a.x.com', { 'x-forwarded-for': '1.1.1.1' })).status).toBe(201);
        expect((await post(app, 'b.x.com', { 'x-forwarded-for': '1.1.1.1' })).status).toBe(429);
        expect((await post(app, 'x.github.io', { 'x-forwarded-for': '1.1.1.1' })).status).toBe(201);
        expect((await post(app, 'y.github.io', { 'x-forwarded-for': '1.1.1.1' })).status).toBe(201);
    });

    it('hands out a recent finished scan of the same URL instead of refusing a busy domain', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '100', SCAN_LIMIT_PER_DOMAIN: '1', ...behindProxy }));
        const first = createScanResponseSchema.parse(await (await post(app, 'busy.example.com', { 'x-forwarded-for': '1.1.1.1' })).json());
        await vi.waitFor(async () => expect(scanSnapshotSchema.parse(await (await app.request(`/v1/scans/${first.publicId}`)).json()).status).toBe('completed'));

        const again = await post(app, 'busy.example.com', { 'x-forwarded-for': '2.2.2.2' });
        expect(again.status).toBe(201);
        expect(createScanResponseSchema.parse(await again.json()).publicId).toBe(first.publicId);
        expect((await post(app, 'busy.example.com/other', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(429);
    });

    it('never hands out a scan of a URL whose query values were hidden, since another value looks the same', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '100', SCAN_LIMIT_PER_DOMAIN: '1', ...behindProxy }));
        const first = createScanResponseSchema.parse(await (await post(app, 'busy.example.org/?id=1', { 'x-forwarded-for': '1.1.1.1' })).json());
        await vi.waitFor(async () => expect(scanSnapshotSchema.parse(await (await app.request(`/v1/scans/${first.publicId}`)).json()).status).toBe('completed'));

        expect((await post(app, 'busy.example.org/?id=2', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(429);
    });

    it('ignores X-Forwarded-For when no proxy is configured', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '1', SCAN_LIMIT_PER_DOMAIN: '100' }));
        expect((await post(app, 'a.example.com', { 'x-forwarded-for': '1.1.1.1' })).status).toBe(201);
        expect((await post(app, 'b.example.com', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(429);
    });

    it('does not count reads', async () => {
        const app = createApp(testContainer({ SCAN_LIMIT_PER_IP: '1', SCAN_LIMIT_PER_DOMAIN: '100' }));
        const { publicId } = createScanResponseSchema.parse(await (await post(app, 'a.example.com')).json());
        for (let i = 0; i < 5; i += 1) expect((await app.request(`/v1/scans/${publicId}`)).status).toBe(200);
    });
});
