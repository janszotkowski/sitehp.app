import type { Redis } from 'ioredis';
import type { Logger } from '@platform/logger.ts';
import type { ScanSignal } from '@modules/scans/ports.ts';

const channelOf = (publicId: string) => `sitehp:scan:${publicId}`;

/**
 * "This scan changed", over Redis pub/sub: a worker publishes an event, the API process that serves the stream wakes at once.
 * Carries no data (the event is read from the database), so a lost or doubled message changes nothing but a delay.
 * A subscribed connection can do nothing else, so it has its own; a channel is subscribed while someone waits on it.
 */
export const createRedisScanSignal = (redis: Redis, logger: Pick<Logger, 'error'>): ScanSignal & { close: () => Promise<void> } => {
    const subscriber = redis.duplicate();
    // `duplicate()` copies the options, not the listeners: without its own an error would end the process.
    subscriber.on('error', (error: Error) => logger.error({ err: error }, 'redis subscriber error'));
    const waiting = new Map<string, Set<() => void>>();

    subscriber.on('message', (channel: string) => {
        for (const onWake of waiting.get(channel) ?? []) onWake();
    });

    return {
        notify: async (publicId) => {
            await redis.publish(channelOf(publicId), '1');
        },
        subscribe: (publicId, onWake) => {
            const channel = channelOf(publicId);
            const set = waiting.get(channel) ?? new Set<() => void>();
            if (set.size === 0) {
                waiting.set(channel, set);
                subscriber.subscribe(channel).catch(() => undefined);
            }
            set.add(onWake);
            return () => {
                set.delete(onWake);
                if (set.size === 0) {
                    waiting.delete(channel);
                    subscriber.unsubscribe(channel).catch(() => undefined);
                }
            };
        },
        close: async () => {
            subscriber.disconnect();
        },
    };
};
