import type { ScanSnapshot } from '@sitehp.app/core/browser';

/**
 * Hands the first snapshot from the form to the report page. The POST already
 * returned everything needed to draw the report, so the page renders at once
 * after the navigation instead of waiting for a second request. Browser only:
 * on the server nothing ever puts a snapshot here, and the loader falls back
 * to the backend. Replaced by the query cache when TanStack Query arrives.
 */
const cache = new Map<string, ScanSnapshot>();

export const rememberSnapshot = (snapshot: ScanSnapshot): void => {
    cache.set(snapshot.publicId, snapshot);
};

/** Returns the remembered snapshot once, so a later visit gets fresh state. */
export const takeSnapshot = (publicId: string): ScanSnapshot | undefined => {
    const snapshot = cache.get(publicId);
    cache.delete(publicId);
    return snapshot;
};
