import { writeFile } from 'node:fs/promises';
import type { Logger } from '@platform/logger.ts';
import type { Clock } from '@platform/ports.ts';

export const HEARTBEAT_EVERY_MS = 15_000;

/**
 * A process with no HTTP of its own (the worker) proves it is alive by writing the time to a file at start and then every `everyMs`.
 * A health check calls it healthy while the file's mtime is under 60 s old: a blocked event loop or a dead process stops the writes.
 * Returns the function that stops it.
 */
export const startHeartbeat = (file: string, clock: Clock, logger: Pick<Logger, 'error'>, everyMs: number = HEARTBEAT_EVERY_MS): (() => void) => {
    const beat = (): void => {
        writeFile(file, `${clock.now().toISOString()}\n`).catch((error: unknown) => logger.error({ err: error, file }, 'writing the heartbeat failed'));
    };
    beat();
    const timer = setInterval(beat, everyMs);
    timer.unref();
    return () => clearInterval(timer);
};
