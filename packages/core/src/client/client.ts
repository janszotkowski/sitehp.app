import { createScanResponseSchema, isTerminalScanEvent, scanEventSchema, scanSnapshotSchema, type CreateScanResponse, type ScanEvent, type ScanSnapshot } from '../contract/scan.ts';
import { healthResponseSchema, type HealthResponse } from '../contract/health.ts';
import { ApiError, apiErrorFromResponse } from './errors.ts';
import { streamEvents, type StreamCredentials, type StreamHandle, type StreamRetry } from './stream.ts';
import type { ZodMiniType } from 'zod/mini';

export type ApiClientOptions = {
    /** Origin of the API, e.g. `https://api.sitehp.app`. The `/v1` prefix is part of the contract, not of this value. */
    baseUrl: string;
    /** Defaults to the global `fetch`. Tests pass `app.request`; the SSR loader and the browser use different base URLs. */
    fetch?: typeof fetch;
    /** Set to `include` to send cookies on cross-origin calls (the browser to `api.sitehp.app`). */
    credentials?: StreamCredentials;
};

export type StreamHandlers<Event> = {
    onEvent: (event: Event) => void;
    onOpen?: () => void;
    onError?: (error: Error) => void;
    retry?: StreamRetry;
    /** Resume after this event id from the first connection, e.g. the `lastEventId` of the snapshot already on screen. */
    lastEventId?: string | null;
};

/**
 * The one typed way to call the sitehp.app API. The frontend (SSR loader and
 * browser), the CLI and the GitHub Action all use it, so there is a single
 * implementation of every call. Every response and every event is validated
 * against the contract schemas; the typed result is what comes out.
 */
export const createApiClient = ({ baseUrl, fetch: customFetch, credentials }: ApiClientOptions) => {
    const doFetch: typeof fetch = customFetch ?? ((input, init) => globalThis.fetch(input, init));
    const url = (path: string): string => new URL(path, baseUrl).toString();

    const request = async <Schema extends ZodMiniType>(path: string, schema: Schema, init?: { method: 'POST'; body: unknown }): Promise<ReturnType<Schema['parse']>> => {
        const response = await doFetch(url(path), {
            headers: { Accept: 'application/json', ...(init === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(init === undefined ? {} : { method: init.method, body: JSON.stringify(init.body) }),
            ...(credentials === undefined ? {} : { credentials }),
        });
        if (!response.ok) throw await apiErrorFromResponse(response);

        const parsed = schema.safeParse(await response.json().catch(() => undefined));
        if (!parsed.success) {
            // The server answered, but not with the contract: that is a bug on one side, reported as INTERNAL.
            throw new ApiError('INTERNAL', `The response of ${path} does not match the contract.`, response.status, response.headers.get('x-request-id') ?? undefined);
        }
        return parsed.data as ReturnType<Schema['parse']>;
    };

    const get = <Schema extends ZodMiniType>(path: string, schema: Schema) => request(path, schema);

    return {
        /** `GET /v1/health` */
        health: (): Promise<HealthResponse> => get('/v1/health', healthResponseSchema),

        /** `POST /v1/scans`: starts a scan. The response has the public id and the first snapshot, enough to draw the report at once. */
        createScan: (targetUrl: string, options: { fresh?: boolean; checks?: readonly string[] } = {}): Promise<CreateScanResponse> =>
            request('/v1/scans', createScanResponseSchema, {
                method: 'POST',
                body: { url: targetUrl, ...(options.fresh === true ? { fresh: true } : {}), ...(options.checks === undefined ? {} : { checks: options.checks }) },
            }),

        /** `GET /v1/scans/:publicId`: the current state of a scan, finished or running. */
        getScan: (publicId: string): Promise<ScanSnapshot> => get(`/v1/scans/${encodeURIComponent(publicId)}`, scanSnapshotSchema),

        /** `GET /v1/scans/:publicId/events`: follows a scan live, resuming after `lastEventId`, and ends at `scan.completed` or `scan.failed`. */
        subscribeScan: (publicId: string, handlers: StreamHandlers<ScanEvent>): StreamHandle =>
            streamEvents<ScanEvent>({
                url: url(`/v1/scans/${encodeURIComponent(publicId)}/events`),
                fetch: doFetch,
                credentials,
                parse: (message) => scanEventSchema.parse(JSON.parse(message.data)),
                isTerminal: isTerminalScanEvent,
                onEvent: handlers.onEvent,
                onOpen: handlers.onOpen,
                onError: handlers.onError,
                retry: handlers.retry,
                lastEventId: handlers.lastEventId ?? undefined,
            }),
    };
};

export type ApiClient = ReturnType<typeof createApiClient>;
