import { Redis } from 'ioredis';
import type { Logger } from '@platform/logger.ts';

/**
 * A connection for BullMQ and the wake-up channel.
 * - `blocking: true` is the BullMQ worker's: `maxRetriesPerRequest: null` (BullMQ requires it of a connection it blocks on), so a command
 *   waits for Redis to come back instead of failing, and the worker carries on after a restart of Redis.
 * - Otherwise a command fails after one reconnect attempt: queueing a scan, asking for a job's state or a wake-up signal must not hang
 *   while Redis is away (the API answers with an error, the reaper leaves the scan for the next round).
 */
export const connectRedis = (url: string, logger: Pick<Logger, 'error' | 'warn' | 'info'>, { blocking = false }: { blocking?: boolean } = {}): Redis => {
    const redis = new Redis(url, { maxRetriesPerRequest: blocking ? null : 1, connectionName: blocking ? 'sitehp-worker' : 'sitehp' });
    // Without a listener an error event ends the process. Redis being away is a condition to log, not a crash.
    redis.on('error', (error: Error) => logger.error({ err: error }, 'redis error'));
    redis.on('ready', () => logger.info('redis ready'));
    redis.on('close', () => logger.warn('redis connection closed'));
    return redis;
};
