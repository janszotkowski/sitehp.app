import { isFinished, reduceScan, type ScanSnapshot } from '@sitehp.app/core/browser';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createApi } from '@lib/api';
import { isFatalPollError, newerSnapshot } from '@lib/scanSnapshot';

type ScanFollow = {
    snapshot: ScanSnapshot;
    /** Still running and still followed. */
    live: boolean;
    /** Several polls in a row failed: the page says so and offers `retry`; polling goes on, ever less often. */
    connectionLost: boolean;
    /** The API refused for good (gone, forbidden) while the scan was running: it can no longer be followed. */
    ended: boolean;
    /** Polls at once, without waiting for the backoff. */
    retry: () => void;
};

/** Where a scan's snapshot lives in the query cache. */
export const scanQueryKey = (publicId: string) => ['scan', publicId] as const;

const POLL_MS = 2000;

/** Failed polls in a row before the page says the connection is lost. */
const CONNECTION_LOST_AFTER = 3;

/**
 * How a scan's snapshot is polled once its stream gave up: every 2 s until it is finished, a failed poll retried with
 * TanStack Query's backoff (1 s doubling to 30 s), a refusal for good (gone, forbidden) not retried at all.
 */
export const scanQueryOptions = (initial: ScanSnapshot, polling: boolean) =>
    queryOptions({
        queryKey: scanQueryKey(initial.publicId),
        queryFn: () => createApi().getScan(initial.publicId),
        initialData: initial,
        enabled: polling,
        refetchInterval: (current) => (current.state.status === 'error' || isFinished(current.state.data ?? initial) ? false : POLL_MS),
        retry: (_failures, error) => !isFatalPollError(error),
        // A poll and the loader can each bring a snapshot: keep whichever is further along.
        structuralSharing: (previous, next) => (previous === undefined ? next : newerSnapshot(previous as ScanSnapshot, next as ScanSnapshot)),
    });

/**
 * Follows a scan live. It starts from the snapshot the page already has, opens the stream after that snapshot's last
 * event, and folds every event into the query cache with the same reducer the backend uses. If the stream cannot be
 * kept alive, the query polls the snapshot instead (`scanQueryOptions`); it runs one request at a time, so an older answer never lands after a newer one.
 */
export const useScan = (initial: ScanSnapshot): ScanFollow => {
    const queryClient = useQueryClient();
    const [streamDown, setStreamDown] = useState(false);
    // Polled only once the stream gave up.
    const query = useQuery(scanQueryOptions(initial, streamDown));

    // The loader may re-run with a later snapshot (even a finished one) than the cache already holds.
    useEffect(() => {
        queryClient.setQueryData<ScanSnapshot>(scanQueryKey(initial.publicId), (current) => (current === undefined ? initial : newerSnapshot(current, initial)));
    }, [queryClient, initial]);

    useEffect(() => {
        if (isFinished(initial)) return undefined;
        const stream = createApi().subscribeScan(initial.publicId, {
            lastEventId: initial.lastEventId,
            onEvent: (event) => queryClient.setQueryData<ScanSnapshot>(scanQueryKey(initial.publicId), (current) => reduceScan(current ?? initial, event)),
            onError: () => setStreamDown(true),
        });
        return () => stream.close();
    }, [queryClient, initial]);

    const snapshot = query.data;
    const ended = query.status === 'error' && isFatalPollError(query.error) && !isFinished(snapshot);
    const running = !isFinished(snapshot) && !ended;
    return {
        snapshot,
        live: running,
        connectionLost: running && query.failureCount >= CONNECTION_LOST_AFTER,
        ended,
        retry: () => void query.refetch(),
    };
};
