import { isIP } from 'node:net';

/**
 * Whether an IP address belongs to the public internet. This is the heart of the
 * protection against server-side request forgery (SSRF): a scanner that fetches
 * whatever address a stranger types must never reach the network it runs in.
 *
 * It is an allowlist for IPv6 (only global unicast `2000::/3`, minus the special
 * ranges inside it) and a blocklist of every special-purpose range for IPv4. An
 * address that is not a valid IP at all is not public. Addresses that embed an
 * IPv4 address (IPv4-mapped, NAT64, 6to4) are judged by the embedded address, so
 * `::ffff:127.0.0.1` cannot slip through. A network that runs NAT64 at a prefix of
 * its own lists it in `nat64Prefixes`, and addresses inside it are judged the same way.
 */

const ipv4ToNumber = (address: string): number | undefined => {
    const parts = address.split('.');
    if (parts.length !== 4) return undefined;
    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return undefined;
        const octet = Number(part);
        if (octet > 255) return undefined;
        value = value * 256 + octet;
    }
    return value;
};

/** `[network, prefix length]` of every IPv4 range that is not the public internet. */
const NON_PUBLIC_V4: ReadonlyArray<readonly [string, number]> = [
    ['0.0.0.0', 8], // "this" network
    ['10.0.0.0', 8], // private
    ['100.64.0.0', 10], // carrier-grade NAT
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local, including the cloud metadata address 169.254.169.254
    ['172.16.0.0', 12], // private
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // documentation
    ['192.88.99.0', 24], // 6to4 relay anycast
    ['192.168.0.0', 16], // private
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // documentation
    ['203.0.113.0', 24], // documentation
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved, and the broadcast address
];

const inV4Range = (value: number, network: string, prefix: number): boolean => {
    const base = ipv4ToNumber(network);
    if (base === undefined) return false;
    const size = 2 ** (32 - prefix);
    return Math.floor(value / size) === Math.floor(base / size);
};

const isPublicV4 = (address: string): boolean => {
    const value = ipv4ToNumber(address);
    if (value === undefined) return false;
    return !NON_PUBLIC_V4.some(([network, prefix]) => inV4Range(value, network, prefix));
};

/** Parses an IPv6 address into 128 bits, or `undefined` if it is not a plain IPv6 address (zone ids are refused). */
const parseV6 = (address: string): bigint | undefined => {
    if (address.includes('%')) return undefined;
    let text = address;

    // A trailing dotted IPv4 (`::ffff:1.2.3.4`) is two 16-bit groups.
    const lastColon = text.lastIndexOf(':');
    const tail = text.slice(lastColon + 1);
    if (tail.includes('.')) {
        const v4 = ipv4ToNumber(tail);
        if (v4 === undefined) return undefined;
        text = `${text.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
    }

    const halves = text.split('::');
    if (halves.length > 2) return undefined;
    const toGroups = (part: string): string[] => (part === '' ? [] : part.split(':'));
    const head = toGroups(halves[0] ?? '');
    const rest = toGroups(halves[1] ?? '');
    const missing = 8 - head.length - rest.length;
    if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;

    const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'), ...rest];
    if (groups.length !== 8) return undefined;

    let value = 0n;
    for (const group of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
        value = (value << 16n) | BigInt(`0x${group}`);
    }
    return value;
};

const prefixOf = (value: bigint, bits: number): bigint => value >> BigInt(128 - bits);

const inV6Range = (value: bigint, network: bigint, bits: number): boolean => prefixOf(value, bits) === prefixOf(network, bits);

const embeddedV4 = (value: bigint, shiftBits: bigint): string => {
    const v4 = Number((value >> shiftBits) & 0xffffffffn);
    return [v4 >>> 24, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join('.');
};

const isPublicV6 = (address: string, nat64Prefixes: readonly Cidr[]): boolean => {
    const value = parseV6(address);
    if (value === undefined) return false;

    // IPv4-mapped (::ffff:0:0/96) and the deprecated IPv4-compatible (::/96) forms: judge the IPv4 address inside.
    if (inV6Range(value, 0xffffn << 32n, 96)) return isPublicV4(embeddedV4(value, 0n));
    // NAT64 (64:ff9b::/96): the IPv4 address is in the last 32 bits.
    if (inV6Range(value, 0x64ff9bn << 96n, 96)) return isPublicV4(embeddedV4(value, 0n));
    if (nat64Prefixes.some((prefix) => inV6Range(value, prefix.network, prefix.bits))) return isPublicV4(embeddedV4(value, 0n));
    // 6to4 (2002::/16): the IPv4 address is in bits 16–47.
    if (inV6Range(value, 0x2002n << 112n, 16)) return isPublicV4(embeddedV4(value, 80n));

    // Only global unicast, 2000::/3, can be public.
    if (!inV6Range(value, 0x2000n << 112n, 3)) return false;

    const special: ReadonlyArray<readonly [bigint, number]> = [
        [0x2001n << 112n, 23], // IETF protocol assignments, including Teredo 2001::/32
        [0x20010db8n << 96n, 32], // documentation
        [0x3fffn << 112n, 20], // documentation
    ];
    return !special.some(([network, bits]) => inV6Range(value, network, bits));
};

/**
 * What one caller is counted as: an IPv4 address as it is, an IPv6 address by its /64, because one
 * household or server usually holds a whole /64 and could otherwise take a fresh address per request.
 * An IPv4-mapped address counts as the IPv4 address inside it.
 */
export const callerKey = (address: string): string => {
    if (isIP(address) !== 6) return address;
    const value = parseV6(address);
    if (value === undefined) return address;
    if (inV6Range(value, 0xffffn << 32n, 96)) return embeddedV4(value, 0n);
    const prefix = value >> 64n;
    const groups = [48n, 32n, 16n, 0n].map((shift) => ((prefix >> shift) & 0xffffn).toString(16));
    return `${groups.join(':')}::/64`;
};

/** A /48 may use this many times the limit of one caller (a /64): room for a household or office of /64s, not for 65,536. */
const IPV6_NETWORK_FACTOR = 10;

/** The /48 an IPv6 caller key (`a:b:c:d::/64`) lies in: one holder of a /48 has 65,536 /64s. Undefined for an IPv4 caller. */
const callerNetworkKey = (key: string): string | undefined => (key.endsWith('::/64') ? `${key.split(':').slice(0, 3).join(':')}::/48` : undefined);

/**
 * The counters one caller (a `callerKey`) is held to at `limit`, each key under `prefix` when one is given: the caller itself, and for
 * IPv6 also its /48 at `IPV6_NETWORK_FACTOR` times the limit. A request is refused when any of them is full.
 */
export const callerLimits = (key: string, limit: number, prefix?: string): Array<{ key: string; limit: number }> => {
    const named = (name: string) => (prefix === undefined ? name : `${prefix}:${name}`);
    const network = callerNetworkKey(key);
    return [{ key: named(key), limit }, ...(network === undefined ? [] : [{ key: named(network), limit: limit * IPV6_NETWORK_FACTOR }])];
};

export const isPublicIp = (address: string, nat64Prefixes: readonly Cidr[] = []): boolean => {
    const family = isIP(address);
    if (family === 4) return isPublicV4(address);
    if (family === 6) return isPublicV6(address, nat64Prefixes);
    return false;
};

/** An address range from configuration (trusted proxies, NAT64 prefixes). Held as 128 bits: an IPv4 range in its IPv4-mapped form. */
export type Cidr = { family: 4 | 6; network: bigint; bits: number };

const IPV4_MAPPED = 0xffffn << 32n;

/** An address as 128 bits; an IPv4 address (and an IPv4-mapped one, as a dual-stack socket reports it) in the IPv4-mapped form. */
const toBits = (address: string): bigint | undefined => {
    const family = isIP(address);
    if (family === 4) {
        const v4 = ipv4ToNumber(address);
        return v4 === undefined ? undefined : IPV4_MAPPED | BigInt(v4);
    }
    return family === 6 ? parseV6(address) : undefined;
};

/** `10.0.0.0/8`, `2001:db8::/32`; undefined when it is not one. */
export const parseCidr = (text: string): Cidr | undefined => {
    const [address = '', bits, ...rest] = text.trim().split('/');
    if (rest.length > 0 || bits === undefined || !/^\d{1,3}$/.test(bits)) return undefined;
    const network = toBits(address);
    const family = isIP(address) === 4 ? 4 : 6;
    if (network === undefined || Number(bits) > (family === 4 ? 32 : 128)) return undefined;
    return { family, network, bits: Number(bits) + (family === 4 ? 96 : 0) };
};

export const inCidr = (address: string, cidr: Cidr): boolean => {
    const value = toBits(address);
    return value !== undefined && inV6Range(value, cidr.network, cidr.bits);
};
