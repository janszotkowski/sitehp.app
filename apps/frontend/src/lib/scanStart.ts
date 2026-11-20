import { ApiError, type CreateScanResponse } from '@sitehp.app/core/browser';
import { createApi } from '@lib/api';
import { failureCodeOf, type FailureCode } from '@lib/apiErrors';
import { rememberSnapshot } from '@lib/scanCache';

export type ScanStart = { ok: true; publicId: CreateScanResponse['publicId'] } | { ok: false; failure: FailureCode; urlReason: string | undefined };

/**
 * Starts a scan and keeps its first snapshot for the report page. Never throws: a failure comes back as its code, with the
 * server's reason for the address when it rejected one. Loaded on its own (`ScanForm` imports it when the field gets the focus),
 * so the API client and its schemas stay out of the bundle a page needs before it can paint.
 */
export const startScan = async (url: string, checks?: readonly string[]): Promise<ScanStart> => {
    try {
        const { publicId, snapshot } = await createApi().createScan(url, checks === undefined ? {} : { checks });
        rememberSnapshot(snapshot);
        return { ok: true, publicId };
    } catch (failure) {
        const urlReason = failure instanceof ApiError ? failure.details?.find((detail) => detail.path === 'url')?.message : undefined;
        return { ok: false, failure: failureCodeOf(failure), urlReason };
    }
};
