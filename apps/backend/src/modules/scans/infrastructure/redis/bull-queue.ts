import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '@platform/logger.ts';
import type { JobQueue, ScanJob } from '@modules/scans/ports.ts';

/** The queue for scans that only read: HTTP, TLS, DNS and HTML. The heavy queue (a rendered page) joins it with the browser. */
export const SCAN_QUEUE = 'light';
const PREFIX = 'sitehp';

/** Every key BullMQ writes starts with this, so tests can run side by side and a shared Redis stays tidy. */
export type QueueNames = { prefix?: string };

/**
 * The API's side (and the worker's reaper, which asks whether a job still exists): puts a scan on the queue and does not wait for it. The job id is the scan's public id, so a scan can be queued once.
 * A scan does its own error handling (it ends in `scan.failed`), so a job is never retried for a failure; a job whose worker died is
 * picked up again by another (BullMQ's stalled-job check).
 */
export const createBullJobQueue = (redis: Redis, names: QueueNames = {}): JobQueue & { counts: () => Promise<Record<string, number>>; close: () => Promise<void> } => {
    const queue = new Queue<ScanJob>(SCAN_QUEUE, {
        connection: redis,
        prefix: names.prefix ?? PREFIX,
        // A job carries the address as typed, query values included: an ended job is kept only briefly (the reaper only asks whether one still waits or runs).
        defaultJobOptions: { attempts: 1, removeOnComplete: { age: 300, count: 1000 }, removeOnFail: { age: 3600, count: 1000 } },
    });
    return {
        enqueue: async (job) => {
            await queue.add('scan', job, { jobId: job.publicId });
        },
        isPending: async (publicId) => {
            const state = await queue.getJobState(publicId);
            // `unknown`: no such job (Redis lost it, or it was removed after it ended).
            return state !== 'completed' && state !== 'failed' && state !== 'unknown';
        },
        counts: () => queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        close: () => queue.close(),
    };
};

export type ScanWorkerOptions = QueueNames & {
    concurrency: number;
    logger: Pick<Logger, 'debug' | 'error' | 'info' | 'warn'>;
    /** Ends the scan of a job BullMQ gave up on (it stalled more than `maxStalledCount` times, or the run threw), instead of leaving it to the reaper. */
    onFailed?: (job: ScanJob) => Promise<void>;
};

/**
 * The worker's side: takes scans off the queue, `concurrency` at once, and runs them. `close` stops taking new ones and waits for the
 * running ones to finish, so a deploy does not cut a scan in half.
 */
export const createScanWorker = (redis: Redis, run: (job: ScanJob) => Promise<void>, options: ScanWorkerOptions): { close: () => Promise<void> } => {
    const worker = new Worker<ScanJob>(SCAN_QUEUE, (job) => run(job.data), {
        connection: redis,
        prefix: options.prefix ?? PREFIX,
        concurrency: options.concurrency,
        // A worker that dies leaves its job locked until the lock runs out; another worker then takes it, at most twice.
        lockDuration: 60_000,
        maxStalledCount: 2,
    });
    worker.on('active', (job) => options.logger.debug({ publicId: job.data.publicId, jobId: job.id }, 'job started'));
    worker.on('completed', (job) => options.logger.debug({ publicId: job.data.publicId, jobId: job.id }, 'job finished'));
    worker.on('failed', (job, error) => {
        options.logger.error({ err: error, publicId: job?.data.publicId, jobId: job?.id }, 'job failed');
        if (job !== undefined)
            options.onFailed?.(job.data).catch((failure: unknown) => options.logger.error({ err: failure, publicId: job.data.publicId }, 'failing the scan of a failed job did not work'));
    });
    worker.on('stalled', (jobId) => options.logger.warn({ jobId }, 'job stalled, another worker takes it'));
    worker.on('error', (error) => options.logger.error({ err: error }, 'worker error'));
    return { close: () => worker.close() };
};
