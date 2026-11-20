export type ApiUrlInput = {
    /** True while rendering on the server (SSR loaders). */
    ssr: boolean;
    /** Origin the browser calls, e.g. https://api.sitehp.app. */
    publicUrl: string;
    /** Origin the server calls: usually an internal address of the same backend. Falls back to the public one. */
    internalUrl: string | undefined;
};

/**
 * Two callers, one backend: the browser calls the public origin directly (CORS with
 * credentials, no proxy that could buffer a stream), while the SSR loader may use
 * an internal address that never leaves the network.
 */
export const resolveApiBaseUrl = ({ ssr, publicUrl, internalUrl }: ApiUrlInput): string => {
    const chosen = ssr && internalUrl !== undefined && internalUrl !== '' ? internalUrl : publicUrl;
    return chosen.replace(/\/$/, '');
};

const configuredPublicUrl: unknown = import.meta.env.VITE_API_URL;

export const PUBLIC_API_URL: string = typeof configuredPublicUrl === 'string' && configuredPublicUrl !== '' ? configuredPublicUrl : 'http://localhost:4000';

/** Read at request time on the server only; it is not prefixed with VITE_, so it is never bundled for the browser. */
export const apiBaseUrl = (): string =>
    resolveApiBaseUrl({
        ssr: import.meta.env.SSR,
        publicUrl: PUBLIC_API_URL,
        internalUrl: import.meta.env.SSR ? process.env['API_INTERNAL_URL'] : undefined,
    });
