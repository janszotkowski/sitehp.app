import type { Config } from '@config/env.ts';
import type { Logger } from '@platform/logger.ts';
import type { ScanRunner } from '@modules/scans/application/scan-runner.ts';

const REAP_EVERY_MS = 60_000;

/** Room past the deadline for a run that has just been stopped to write its `scan.failed`, and for one look of the reaper. */
const STUCK_MARGIN_MS = 60_000;

/**
 * How long a `running` scan may go without an event before the reaper judges it: a live run ends itself by `SCAN_DEADLINE_MS`, so
 * a scan quiet for longer than that (plus the margin) whose job is gone is not coming back.
 */
export const stuckAfterMs = (config: Pick<Config, 'SCAN_DEADLINE_MS'>): number => config.SCAN_DEADLINE_MS + STUCK_MARGIN_MS;

/**
 * Fails, every minute, the scans whose job was lost (Redis restarted without it, a worker killed for good, a process restarted while
 * it ran scans itself) instead of leaving them to wait for ever. The first pass can use a shorter age: a process that runs scans in
 * memory knows, right after it starts, that none of the stored `running` scans is its own. Returns the function that stops it.
 */
export const startReaper = (runner: Pick<ScanRunner, 'reapStuck'>, logger: Pick<Logger, 'error'>, maxAgeMs: number, firstPassMaxAgeMs = maxAgeMs): (() => void) => {
    const reap = (age: number): void => {
        runner.reapStuck(age).catch((error: unknown) => logger.error({ err: error }, 'looking for stuck scans failed'));
    };
    reap(firstPassMaxAgeMs);
    const timer = setInterval(() => reap(maxAgeMs), REAP_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
};
