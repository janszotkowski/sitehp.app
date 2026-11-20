import { createSocket, type Socket } from 'node:dgram';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockedAddressError, createDnsResolver, createGuardedLookup, type Resolver } from '@platform/net/guarded-lookup.ts';
import { parseCidr } from '@platform/net/ip.ts';

type Outcome = { error: Error | null; result: unknown; family?: number | undefined };

const lookup = (resolve: Resolver, host: string, all: boolean, isAllowed?: (address: string, hostname: string) => boolean): Promise<Outcome> =>
    new Promise((done) => {
        const guarded = createGuardedLookup({ resolve, ...(isAllowed === undefined ? {} : { isAllowed }) });
        guarded(host, { all }, (error: Error | null, result: unknown, family?: number) => done({ error, result, family }));
    });

const answer =
    (...addresses: Array<[string, 4 | 6]>): Resolver =>
    () =>
        Promise.resolve(addresses.map(([address, family]) => ({ address, family })));

describe('createGuardedLookup', () => {
    it('hands back the addresses of a public host', async () => {
        const all = await lookup(answer(['93.184.216.34', 4]), 'example.com', true);
        expect(all.error).toBeNull();
        expect(all.result).toEqual([{ address: '93.184.216.34', family: 4 }]);

        const one = await lookup(answer(['93.184.216.34', 4]), 'example.com', false);
        expect(one.result).toBe('93.184.216.34');
        expect(one.family).toBe(4);
    });

    it.each([
        ['127.0.0.1', 4],
        ['10.0.0.5', 4],
        ['169.254.169.254', 4],
        ['::1', 6],
        ['::ffff:192.168.1.1', 6],
    ] as const)('refuses a host that resolves to %s', async (address, family) => {
        const outcome = await lookup(answer([address, family]), 'evil.test', true);
        expect(outcome.error).toBeInstanceOf(BlockedAddressError);
        expect(outcome.error).toMatchObject({ code: 'ESITEHP_BLOCKED', hostname: 'evil.test' });
    });

    it('refuses the whole host when only ONE of its addresses is internal', async () => {
        const outcome = await lookup(answer(['93.184.216.34', 4], ['10.0.0.5', 4]), 'mixed.test', true);
        expect(outcome.error).toBeInstanceOf(BlockedAddressError);
    });

    it('is not fooled by DNS rebinding: every lookup is checked again, at connection time', async () => {
        let call = 0;
        const rebinding: Resolver = () => {
            call += 1;
            return Promise.resolve([call === 1 ? { address: '93.184.216.34', family: 4 as const } : { address: '127.0.0.1', family: 4 as const }]);
        };
        expect((await lookup(rebinding, 'rebind.test', true)).error).toBeNull();
        expect((await lookup(rebinding, 'rebind.test', true)).error).toBeInstanceOf(BlockedAddressError);
    });

    it('reports a name that does not exist as ENOTFOUND', async () => {
        const outcome = await lookup(answer(), 'nothing.test', true);
        expect(outcome.error).toMatchObject({ code: 'ENOTFOUND' });
    });

    it('passes a resolver failure through', async () => {
        const failing: Resolver = () => Promise.reject(Object.assign(new Error('boom'), { code: 'EAI_AGAIN' }));
        expect((await lookup(failing, 'down.test', true)).error).toMatchObject({ code: 'EAI_AGAIN' });
    });

    it('lets a caller narrow or widen the policy per host', async () => {
        const allowLoopbackForOk = (address: string, hostname: string) => hostname === 'ok.test' || address === '93.184.216.34';
        expect((await lookup(answer(['127.0.0.1', 4]), 'ok.test', true, allowLoopbackForOk)).error).toBeNull();
        expect((await lookup(answer(['127.0.0.1', 4]), 'other.test', true, allowLoopbackForOk)).error).toBeInstanceOf(BlockedAddressError);
    });
});

describe('createGuardedLookup with NAT64 prefixes', () => {
    const nat64 = [parseCidr('2a00:1:64::/96')].filter((cidr) => cidr !== undefined);
    const outcome = (nat64Prefixes: typeof nat64) =>
        new Promise<Error | null>((done) => createGuardedLookup({ resolve: answer(['2a00:1:64::a00:5', 6]), nat64Prefixes })('nat64.test', { all: true }, (error) => done(error)));

    it('judges an address inside a listed prefix by the IPv4 address it carries (10.0.0.5 here)', async () => {
        expect(await outcome([])).toBeNull();
        expect(await outcome(nat64)).toBeInstanceOf(BlockedAddressError);
    });
});

describe('createDnsResolver', () => {
    // A DNS server that takes every query and never answers.
    let silent: Socket;
    beforeAll(async () => {
        silent = createSocket('udp4');
        await new Promise<void>((done) => silent.bind(0, '127.0.0.1', done));
    });
    afterAll(() => silent.close());

    it('gives up on a DNS server that never answers within its timeout, instead of hanging', async () => {
        const resolve = createDnsResolver({ timeoutMs: 100, tries: 2, servers: [`127.0.0.1:${silent.address().port}`] });
        const startedAt = performance.now();
        await expect(resolve('example.com')).rejects.toMatchObject({ code: 'ETIMEOUT' });
        expect(performance.now() - startedAt).toBeLessThan(1500);
    });
});
