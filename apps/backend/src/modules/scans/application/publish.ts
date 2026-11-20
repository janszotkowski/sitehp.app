import type { ScanSnapshot } from '@sitehp.app/core';
import type { Logger } from '@platform/logger.ts';
import type { ScanEventDraft, ScanStore } from '@modules/scans/ports.ts';

/** A snapshot as a client gets it: without the run bookkeeping of the store (`runId`), so it equals the state folded from the stream. */
export const shown = (snapshot: ScanSnapshot): ScanSnapshot => {
    const copy = { ...snapshot };
    delete copy.runId;
    return copy;
};

export type Publish = (publicId: string, draft: ScanEventDraft, derive?: (snapshot: ScanSnapshot) => ScanEventDraft | undefined, runId?: string) => Promise<ScanSnapshot>;

/**
 * The single path of every state change: the store appends the event (and the one `derive` adds) and folds it into the snapshot in one step.
 * `runId` ties the event to a worker run, so a run that was taken over cannot add to the scan (`appendEvent`).
 */
export const publisherOf =
    (store: ScanStore, logger: Logger): Publish =>
    (publicId, draft, derive, runId) =>
        store.publish(publicId, draft, derive, runId).then(({ event, followUp, snapshot }) => {
            for (const published of followUp === undefined ? [event] : [event, followUp]) logger.trace({ publicId, eventId: published.id, type: published.type }, 'event published');
            return snapshot;
        });
