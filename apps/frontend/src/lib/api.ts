import { createApiClient, type ApiClient } from '@sitehp.app/core/browser';
import { apiBaseUrl } from '@config/api';

/** A POST starts a scan: each call carries a fresh `Idempotency-Key`, so the backend starts one scan for it even if the request arrives twice. */
const fetchWithIdempotencyKey: typeof fetch = (input, init) => {
    if (init?.method !== 'POST') return globalThis.fetch(input, init);
    const headers = new Headers(init.headers);
    headers.set('Idempotency-Key', crypto.randomUUID());
    return globalThis.fetch(input, { ...init, headers });
};

/**
 * The one way the frontend talks to the backend: the typed client from core.
 * Created per call, because the base URL differs between the server (SSR) and
 * the browser. No cookies are sent: there is no sign-in yet, and the backend's
 * CORS does not allow credentials. Both change together when sign-in arrives.
 */
export const createApi = (): ApiClient => createApiClient({ baseUrl: apiBaseUrl(), fetch: fetchWithIdempotencyKey });
