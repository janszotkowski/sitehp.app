import { describe, expect, it } from 'vitest';
import { callerLimits, inCidr, isPublicIp, parseCidr, type Cidr } from '@platform/net/ip.ts';

describe('isPublicIp: addresses of the public internet', () => {
    it.each([
        '8.8.8.8',
        '1.1.1.1',
        '93.184.216.34',
        '151.101.1.69',
        '172.15.255.255',
        '172.32.0.0',
        '100.63.255.255',
        '100.128.0.0',
        '2606:4700:4700::1111',
        '2a00:1450:4001:81b::200e',
        '2001:4860:4860::8888',
        '2001:200::1',
    ])('%s is public', (address) => {
        expect(isPublicIp(address)).toBe(true);
    });
});

describe('isPublicIp: IPv4 ranges the scanner must never reach', () => {
    it.each([
        ['0.0.0.0', 'this network'],
        ['0.255.255.255', 'this network'],
        ['10.0.0.1', 'private 10/8'],
        ['10.255.255.255', 'private 10/8'],
        ['100.64.0.1', 'carrier-grade NAT'],
        ['100.127.255.255', 'carrier-grade NAT'],
        ['127.0.0.1', 'loopback'],
        ['127.255.255.254', 'loopback'],
        ['169.254.169.254', 'cloud metadata'],
        ['169.254.0.1', 'link-local'],
        ['172.16.0.1', 'private 172.16/12'],
        ['172.31.255.255', 'private 172.16/12'],
        ['192.0.0.8', 'IETF assignments'],
        ['192.0.2.1', 'documentation'],
        ['192.88.99.1', '6to4 relay'],
        ['192.168.0.1', 'private 192.168/16'],
        ['192.168.255.255', 'private 192.168/16'],
        ['198.18.0.1', 'benchmarking'],
        ['198.19.255.255', 'benchmarking'],
        ['198.51.100.7', 'documentation'],
        ['203.0.113.9', 'documentation'],
        ['224.0.0.1', 'multicast'],
        ['239.255.255.255', 'multicast'],
        ['240.0.0.1', 'reserved'],
        ['255.255.255.255', 'broadcast'],
    ])('%s is not public (%s)', (address) => {
        expect(isPublicIp(address)).toBe(false);
    });
});

describe('isPublicIp: IPv6 ranges the scanner must never reach', () => {
    it.each([
        ['::', 'unspecified'],
        ['::1', 'loopback'],
        ['fe80::1', 'link-local'],
        ['febf::1', 'link-local'],
        ['fc00::1', 'unique local'],
        ['fd12:3456:789a::1', 'unique local'],
        ['ff02::1', 'multicast'],
        ['2001::1', 'Teredo / IETF'],
        ['2001:db8::1', 'documentation'],
        ['3fff::1', 'documentation'],
        ['100::1', 'discard'],
        ['fec0::1', 'site-local'],
    ])('%s is not public (%s)', (address) => {
        expect(isPublicIp(address)).toBe(false);
    });
});

describe('isPublicIp: an IPv6 address that embeds an IPv4 address is judged by the embedded one', () => {
    it.each([
        ['::ffff:127.0.0.1', false],
        ['::ffff:7f00:1', false],
        ['::ffff:10.1.2.3', false],
        ['::ffff:169.254.169.254', false],
        ['::ffff:a9fe:a9fe', false],
        ['::ffff:8.8.8.8', true],
        ['::127.0.0.1', false],
        ['64:ff9b::7f00:1', false],
        ['64:ff9b::a00:1', false],
        ['64:ff9b::808:808', true],
        ['2002:7f00:1::', false],
        ['2002:a9fe:a9fe::1', false],
        ['2002:0808:0808::1', true],
    ])('%s → public: %s', (address, expected) => {
        expect(isPublicIp(address)).toBe(expected);
    });
});

describe('isPublicIp: anything that is not a plain IP address is not public', () => {
    it.each(['', 'example.com', 'localhost', '127.1', '0x7f.0.0.1', '2130706433', '1.2.3', '1.2.3.4.5', '256.1.1.1', '8.8.8.8 ', '[::1]', 'fe80::1%eth0', ':::', '1::2::3', 'gggg::1', '10.0.0.1/8'])(
        '%j is refused',
        (address) => {
            expect(isPublicIp(address)).toBe(false);
        },
    );
});

describe('isPublicIp: a NAT64 prefix of our own network (NAT64_PREFIXES)', () => {
    const prefixes = [parseCidr('2a00:1:64::/96')].filter((cidr): cidr is Cidr => cidr !== undefined);

    it.each([
        ['2a00:1:64::7f00:1', false],
        ['2a00:1:64::a9fe:a9fe', false],
        ['2a00:1:64::808:808', true],
        ['2a00:1:65::7f00:1', true],
    ])('%s → public: %s', (address, expected) => {
        expect(isPublicIp(address, prefixes)).toBe(expected);
    });

    it('is not applied unless listed', () => {
        expect(isPublicIp('2a00:1:64::7f00:1')).toBe(true);
    });
});

describe('parseCidr and inCidr', () => {
    const cidr = (text: string): Cidr => {
        const parsed = parseCidr(text);
        if (parsed === undefined) throw new Error(`not a range: ${text}`);
        return parsed;
    };

    it.each([
        ['10.1.2.3', '10.0.0.0/8', true],
        ['11.0.0.1', '10.0.0.0/8', false],
        ['::ffff:10.1.2.3', '10.0.0.0/8', true],
        ['172.18.0.4', '172.16.0.0/12', true],
        ['fd00::5', 'fd00::/8', true],
        ['fe80::1', 'fd00::/8', false],
        ['10.0.0.1', 'fd00::/8', false],
        ['1.2.3.4', '0.0.0.0/0', true],
        ['1.2.3.4', '1.2.3.4/32', true],
        ['1.2.3.5', '1.2.3.4/32', false],
    ])('%s in %s: %s', (address, range, expected) => {
        expect(inCidr(address, cidr(range))).toBe(expected);
    });

    it.each(['', '10.0.0.0', '10.0.0.0/33', '::/129', 'example.com/8', '10.0.0.0/8/8', '10.0.0.0/x'])('%j is not a range', (text) => {
        expect(parseCidr(text)).toBeUndefined();
    });

    it('keeps the family', () => {
        expect(cidr('10.0.0.0/8').family).toBe(4);
        expect(cidr('64:ff9b:1::/96')).toMatchObject({ family: 6, bits: 96 });
    });
});

describe('callerLimits', () => {
    it.each([
        [
            '2001:db8:1:2::/64',
            [
                { key: 'ip:2001:db8:1:2::/64', limit: 5 },
                { key: 'ip:2001:db8:1::/48', limit: 50 },
            ],
        ],
        [
            '0:0:0:1::/64',
            [
                { key: 'ip:0:0:0:1::/64', limit: 5 },
                { key: 'ip:0:0:0::/48', limit: 50 },
            ],
        ],
        ['1.2.3.4', [{ key: 'ip:1.2.3.4', limit: 5 }]],
        ['unknown', [{ key: 'ip:unknown', limit: 5 }]],
    ])('%s', (key, expected) => {
        expect(callerLimits(key, 5, 'ip')).toEqual(expected);
    });

    it('names the keys as they are without a prefix', () => {
        expect(callerLimits('2001:db8:1:2::/64', 2).map((bucket) => bucket.key)).toEqual(['2001:db8:1:2::/64', '2001:db8:1::/48']);
    });
});
