import type { Redis } from 'ioredis';
import type { Clock } from '@platform/ports.ts';

export type RateLimitDecision = { allowed: true } | { allowed: false; key: string; retryAfterSec: number };

/** Counts hits per key: in memory for a single process, in Redis when several API processes share the limits. */
export type RateLimiter = {
    /** Counts one hit on every key, or on none of them when any is at its limit (the first such key is returned). */
    hit: (limits: ReadonlyArray<{ key: string; limit: number }>, windowMs: number) => Promise<RateLimitDecision>;
};

const SWEEP_ABOVE = 10_000;
const SWEEP_EVERY_MS = 60_000;

const retryAfter = (msLeft: number): number => Math.max(1, Math.ceil(msLeft / 1000));

/**
 * A fixed window per key: the first hit opens a window, hits inside it count, the next hit after it starts a new one.
 * shortcut: a fixed window lets a burst of twice the limit straddle a boundary, upgrade to a sliding window when that matters.
 */
export const createRateLimiter = (clock: Clock): RateLimiter => {
    const windows = new Map<string, { resetAt: number; count: number }>();
    let nextSweepAt = 0;

    const live = (key: string, now: number) => {
        const entry = windows.get(key);
        return entry !== undefined && entry.resetAt > now ? entry : undefined;
    };

    const hit = (limits: ReadonlyArray<{ key: string; limit: number }>, windowMs: number): RateLimitDecision => {
        const now = clock.now().getTime();
        // Keys are strangers' addresses and domains: drop the expired ones so the map cannot grow without bound.
        // At most once a minute, so a map full of live keys does not cost a full pass on every request.
        if (windows.size > SWEEP_ABOVE && now >= nextSweepAt) {
            nextSweepAt = now + SWEEP_EVERY_MS;
            for (const [name, entry] of windows) if (entry.resetAt <= now) windows.delete(name);
        }

        for (const { key, limit } of limits) {
            const current = live(key, now);
            if (current !== undefined && current.count >= limit) return { allowed: false, key, retryAfterSec: retryAfter(current.resetAt - now) };
        }
        for (const { key } of limits) {
            const current = live(key, now);
            if (current === undefined) windows.set(key, { resetAt: now + windowMs, count: 1 });
            else current.count += 1;
        }
        return { allowed: true };
    };

    return { hit: (limits, windowMs) => Promise.resolve(hit(limits, windowMs)) };
};

/**
 * One script checks every key and only then counts on all of them, so "every key or none" holds under concurrent callers too.
 * Returns the 1-based index of the first full key with its milliseconds left, or 0 when the hit was counted.
 */
const HIT_SCRIPT = `
for i, key in ipairs(KEYS) do
    local count = tonumber(redis.call('GET', key) or '0')
    if count >= tonumber(ARGV[i + 1]) then return {i, redis.call('PTTL', key)} end
end
for _, key in ipairs(KEYS) do
    if redis.call('INCR', key) == 1 then redis.call('PEXPIRE', key, ARGV[1]) end
end
return {0, 0}
`;

/** The same fixed window in Redis (INCR + PEXPIRE), shared by every API process. */
export const createRedisRateLimiter = (redis: Pick<Redis, 'eval'>, { prefix = 'sitehp' }: { prefix?: string } = {}): RateLimiter => ({
    hit: async (limits, windowMs) => {
        if (limits.length === 0) return { allowed: true };
        const keys = limits.map(({ key }) => `${prefix}:rate:${key}`);
        const [index, msLeft] = (await redis.eval(HIT_SCRIPT, keys.length, ...keys, windowMs, ...limits.map(({ limit }) => limit))) as [number, number];
        const full = limits[index - 1];
        return full === undefined ? { allowed: true } : { allowed: false, key: full.key, retryAfterSec: retryAfter(msLeft) };
    },
});
