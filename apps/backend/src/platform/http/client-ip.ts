import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import type { Logger } from '@platform/logger.ts';
import { callerKey, inCidr, type Cidr } from '@platform/net/ip.ts';

export const socketAddress = (c: Context): string | undefined => {
    try {
        return getConnInfo(c).remote.address;
    } catch {
        // No socket: a request injected in a test.
        return undefined;
    }
};

/** Which peers are our proxies, and how many of them a request passes (the settings of the same names). */
export type ProxyTrust = { TRUSTED_PROXY_HOPS: number; TRUSTED_PROXY_CIDRS: readonly Cidr[] };

/** The settings already warned about: once per configuration, not once per request. */
const warnedForwarded = new WeakSet<ProxyTrust>();

/**
 * Who is calling, as the key the rate limits count (an IPv6 caller is its /64, see `callerKey`).
 * Without a proxy in front, the address of the socket. Behind `TRUSTED_PROXY_HOPS` proxies of ours,
 * the entry of `X-Forwarded-For` that the outermost of them appended (counted from the right:
 * anything further left was written by the caller and can be forged).
 */
export const clientIp = (c: Context, trust: ProxyTrust): string => {
    const peer = socketAddress(c);
    // Only a peer inside TRUSTED_PROXY_CIDRS is one of our proxies; anyone else's X-Forwarded-For is its own invention.
    if (trust.TRUSTED_PROXY_HOPS > 0 && peer !== undefined && trust.TRUSTED_PROXY_CIDRS.some((cidr) => inCidr(peer, cidr))) {
        const forwarded = (c.req.header('x-forwarded-for') ?? '')
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part !== '');
        const ip = forwarded[forwarded.length - trust.TRUSTED_PROXY_HOPS];
        if (ip !== undefined) return callerKey(ip);
    } else if (trust.TRUSTED_PROXY_HOPS === 0 && !warnedForwarded.has(trust) && c.req.header('x-forwarded-for') !== undefined) {
        // Behind a proxy that nobody told us about, every caller is the proxy and shares one rate limit: worth saying once.
        warnedForwarded.add(trust);
        (c.get('logger') as Pick<Logger, 'warn'> | undefined)?.warn('a request carries X-Forwarded-For but TRUSTED_PROXY_HOPS is 0: the header is ignored, every caller counts as the proxy');
    }
    // No socket: everyone shares one bucket, which is the safe side.
    return callerKey(peer ?? 'unknown');
};
