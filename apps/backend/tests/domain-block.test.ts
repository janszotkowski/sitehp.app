import { describe, expect, it } from 'vitest';
import { loadConfig } from '@config/env.ts';
import { createApp } from '@composition/app.ts';
import { blockedBy, isBlockedHost, parseBlockList } from '@platform/net/blocked-hosts.ts';
import { createScansService } from '@modules/scans/application/scans-service.ts';
import { createInlineJobQueue, createInMemoryScanStore, createInMemorySiteLog } from '@modules/scans/infrastructure/in-memory.ts';
import { createRateLimiter } from '@platform/rate-limit.ts';
import { captureLogs, fakeFetcher, FIXED_TIME, sequentialIds, testContainer } from '@tests/helpers.ts';

const defaults = (() => {
    const loaded = loadConfig({});
    if (!loaded.ok) throw new Error('config');
    return { tlds: loaded.config.BLOCKED_TLDS, domains: loaded.config.BLOCKED_DOMAINS };
})();

describe('the block list', () => {
    it('blocks Russia, Iran and China by default: their country domains, the Soviet one and the non-Latin ones', () => {
        for (const host of ['yandex.ru', 'www.gov.ru', 'old.example.su', 'xn--80aswg.xn--p1ai', 'shop.ir', 'xn--mgba3a4f16a', 'baidu.cn', 'shop.com.cn', 'xn--fiqs8s', 'xn--fiqz9s']) {
            expect(isBlockedHost(host, defaults), host).toBe(true);
        }
    });

    it('does not block a name that only contains one', () => {
        for (const host of ['example.com', 'ruby.dev', 'brussels.eu', 'cnn.com', 'iran.example.org', 'ru.wikipedia.org', 'seznam.cz']) {
            expect(isBlockedHost(host, defaults), host).toBe(false);
        }
    });

    it('blocks a listed domain with its subdomains and nothing that merely ends in the same letters', () => {
        const rules = { tlds: [], domains: ['bad.example'] };
        expect(isBlockedHost('bad.example', rules)).toBe(true);
        expect(isBlockedHost('www.bad.example', rules)).toBe(true);
        expect(isBlockedHost('notbad.example', rules)).toBe(false);
        expect(isBlockedHost('BAD.example.', rules)).toBe(true);
    });

    it('names the rule that blocks a host: the top-level domain as `*.tld`, or the listed domain', () => {
        expect(blockedBy('a.b.yandex.ru', defaults)).toBe('*.ru');
        expect(blockedBy('www.bad.example', { tlds: [], domains: ['bad.example'] })).toBe('bad.example');
        expect(blockedBy('example.com', defaults)).toBeUndefined();
    });

    it('reads the settings as lower-case ASCII names without dots or empty entries, and refuses what is not a name', () => {
        expect(parseBlockList(' .RU, su ,, xn--p1ai ')).toEqual(['ru', 'su', 'xn--p1ai']);
        // Written in its own script it still matches, because hosts are compared in punycode.
        expect(parseBlockList('рф, пример.рф')).toEqual(['xn--p1ai', 'xn--e1afmkfd.xn--p1ai']);
        for (const bad of ['*.evil.com', 'https://evil.com', 'evil.com:80', 'evil.com/path']) expect(() => parseBlockList(bad), bad).toThrow('is not a domain name');
        expect(loadConfig({ BLOCKED_DOMAINS: '*.evil.com' }).ok).toBe(false);
        const loaded = loadConfig({ BLOCKED_TLDS: '.KP', BLOCKED_DOMAINS: 'Evil.example' });
        expect(loaded.ok && [loaded.config.BLOCKED_TLDS, loaded.config.BLOCKED_DOMAINS]).toEqual([['kp'], ['evil.example']]);
        // An empty list turns blocking off.
        expect(loadConfig({ BLOCKED_TLDS: '' }).ok && loadConfig({ BLOCKED_TLDS: '' })).toMatchObject({ config: { BLOCKED_TLDS: [] } });
    });
});

describe('a scan of a blocked domain', () => {
    it('is remembered under its rule, not its host, so made-up subdomains do not each add a row', async () => {
        const siteLog = createInMemorySiteLog();
        const scans = createScansService({
            store: createInMemoryScanStore(),
            siteLog,
            blockedBy: (host) => blockedBy(host, defaults),
            queue: createInlineJobQueue(
                () => Promise.resolve(),
                () => undefined,
            ),
            fetcher: fakeFetcher(),
            ids: sequentialIds(),
            clock: { now: () => FIXED_TIME },
            logger: captureLogs().logger,
            logClient: false,
            limiter: createRateLimiter({ now: () => FIXED_TIME }),
            limits: { perIp: 100, perDomain: 100, windowMs: 60_000 },
            stepDelayMs: 0,
        });
        for (const host of ['a1.shop.ru', 'b2.shop.ru', 'c3.other.ru']) await expect(scans.create(host)).rejects.toMatchObject({ code: 'DOMAIN_BLOCKED' });
        expect(await siteLog.list()).toEqual([expect.objectContaining({ domain: '*.ru', blockedCount: 3, scanCount: 0 })]);
    });

    it('is refused with DOMAIN_BLOCKED (403) before anything is fetched, and the attempt is remembered', async () => {
        const fetcher = fakeFetcher();
        const container = testContainer({}, fetcher);
        await expect(container.scans.create('https://shop.example.ru/cart?token=secret')).rejects.toMatchObject({ code: 'DOMAIN_BLOCKED' });
        expect(fetcher.requested).toEqual([]);

        const response = await createApp(container).request('/v1/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'baidu.cn' }) });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: 'DOMAIN_BLOCKED' } });
    });

    it('counts against the caller, so one address cannot flood the log with refusals, and not against any domain', async () => {
        const { scans } = testContainer({ SCAN_LIMIT_PER_IP: '2', SCAN_LIMIT_PER_DOMAIN: '1' });
        await expect(scans.create('baidu.cn', '203.0.113.9')).rejects.toMatchObject({ code: 'DOMAIN_BLOCKED' });
        await expect(scans.create('baidu.cn', '203.0.113.9')).rejects.toMatchObject({ code: 'DOMAIN_BLOCKED' });
        await expect(scans.create('baidu.cn', '203.0.113.9')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        // Another caller is not affected, and the blocked attempts used up no domain's limit.
        await expect(scans.create('example.com', '198.51.100.7')).resolves.toMatchObject({ status: 'running' });
    });

    it('can be switched to other countries by configuration', async () => {
        const { scans } = testContainer({ BLOCKED_TLDS: 'kp', BLOCKED_DOMAINS: 'evil.example' });
        await expect(scans.create('news.kp')).rejects.toMatchObject({ code: 'DOMAIN_BLOCKED' });
        await expect(scans.create('www.evil.example')).rejects.toMatchObject({ code: 'DOMAIN_BLOCKED' });
        await expect(scans.create('yandex.ru')).resolves.toMatchObject({ status: 'running' });
    });
});
