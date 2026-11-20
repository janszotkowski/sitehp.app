import { Resolver as DnsResolver } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { isPublicIp, type Cidr } from '@platform/net/ip.ts';

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** The answers that mean "no address of this family", not "the lookup failed". */
const NO_ANSWER = new Set(['ENODATA', 'ENOTFOUND']);

/**
 * Every A and AAAA address of the name, asked straight from the DNS servers (c-ares), with a timeout per try.
 * Not `dns.lookup`: that runs `getaddrinfo` on the libuv thread pool with no timeout, so a few slow DNS servers
 * would stall every file and crypto call of the process. `/etc/hosts` is not read, which a scanner of public sites never needs.
 * One family failing is not fatal: only the addresses returned are ever connected to, and each is checked.
 */
export const createDnsResolver = (options: { timeoutMs: number; tries: number; servers?: string[] }): Resolver => {
    const dns = new DnsResolver({ timeout: options.timeoutMs, tries: options.tries });
    if (options.servers !== undefined) dns.setServers(options.servers);
    return async (hostname) => {
        const answers = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
        const addresses = answers.flatMap((answer, index) => (answer.status === 'fulfilled' ? answer.value.map((address): ResolvedAddress => ({ address, family: index === 0 ? 4 : 6 })) : []));
        const failure = answers.find((answer): answer is PromiseRejectedResult => answer.status === 'rejected' && !NO_ANSWER.has((answer.reason as { code?: string }).code ?? ''));
        if (addresses.length === 0 && failure !== undefined) throw failure.reason;
        return addresses;
    };
};

/** The resolver of every fetch: the system's DNS servers, at most about 5 s for a name. */
export const systemResolver: Resolver = createDnsResolver({ timeoutMs: 2500, tries: 2 });

export type GuardedLookupOptions = {
    resolve?: Resolver;
    /** Decides per address. Defaults to "public internet only"; tests narrow or widen it for their own hosts. */
    isAllowed?: (address: string, hostname: string) => boolean;
    /** NAT64 prefixes of our network (`NAT64_PREFIXES`), for the default rule. */
    nat64Prefixes?: readonly Cidr[];
};

/** Raised when a name resolves to an address the scanner must never connect to. */
export class BlockedAddressError extends Error {
    readonly code = 'ESITEHP_BLOCKED';
    readonly hostname: string;

    constructor(hostname: string) {
        super(`${hostname} resolves to an address that is not on the public internet`);
        this.name = 'BlockedAddressError';
        this.hostname = hostname;
    }
}

/**
 * A DNS lookup for the connection itself. The check happens here, in the lookup that
 * the socket uses, so the address that was checked is the address that is connected to.
 * Checking first and connecting afterwards would leave a gap in which a hostile DNS
 * server could answer differently (DNS rebinding); this has no such gap.
 *
 * If ANY address of the name is not public the whole name is refused: a host that
 * answers with one public and one private address is trying something.
 */
export const createGuardedLookup = (options: GuardedLookupOptions = {}): LookupFunction => {
    const resolve = options.resolve ?? systemResolver;
    const isAllowed = options.isAllowed ?? ((address) => isPublicIp(address, options.nat64Prefixes));

    return (hostname, lookupOptions, callback) => {
        resolve(hostname).then(
            (addresses) => {
                if (addresses.length === 0) {
                    callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), '', 4);
                    return;
                }
                if (addresses.some((entry) => !isAllowed(entry.address, hostname))) {
                    callback(new BlockedAddressError(hostname), '', 4);
                    return;
                }
                if (lookupOptions.all === true) {
                    callback(null, addresses);
                    return;
                }
                const [first] = addresses;
                if (first === undefined) return;
                callback(null, first.address, first.family);
            },
            (error: unknown) => {
                callback(error instanceof Error ? error : new Error(String(error)), '', 4);
            },
        );
    };
};
