import type { ScanSnapshot } from '@sitehp.app/core/browser';
import { notFound } from '@tanstack/react-router';
import { failureCodeOf } from '@lib/apiErrors';
import { takeSnapshot } from '@lib/scanCache';

/** What a report route loads: the snapshot the form already holds, else the API's. An unknown or malformed id is a missing page, whoever asks. */
export const loadReport = async (publicId: string): Promise<ScanSnapshot> => {
    // Arriving from the form: the POST already returned the first snapshot, so the page renders at once.
    const fromForm = takeSnapshot(publicId);
    if (fromForm !== undefined) return fromForm;
    try {
        // The loader is not split off with the page, so the API client (and its schemas) is loaded here, not with every page.
        const { createApi } = await import('@lib/api');
        return await createApi().getScan(publicId);
    } catch (error) {
        const code = failureCodeOf(error);
        if (code === 'NOT_FOUND' || code === 'VALIDATION_FAILED') throw notFound();
        throw error;
    }
};
