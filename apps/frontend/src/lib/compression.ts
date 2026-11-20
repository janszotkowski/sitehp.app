import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

export type Encoding = 'br' | 'gzip';

// Below this a compressed body saves less than the round of headers it costs.
const MIN_BYTES = 1024;

/** Brotli when the client takes it, else gzip, else nothing. A `q=0` refuses an encoding; other weights are not ranked (every browser sends both). */
export const encodingFor = (acceptEncoding: string | null): Encoding | undefined => {
    const offered = new Set(
        (acceptEncoding ?? '')
            .toLowerCase()
            .split(',')
            .map((part) => part.trim().split(';'))
            .filter(([, ...params]) => !params.some((param) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(param)))
            .map(([name]) => name?.trim() ?? ''),
    );
    if (offered.has('br')) return 'br';
    if (offered.has('gzip') || offered.has('*')) return 'gzip';
    return undefined;
};

/**
 * A rendered text response (HTML, Markdown) compressed for the client. Nitro compresses only the static files it
 * serves itself, so every page that goes through `src/server.ts` left uncompressed (34 kB of HTML for `/en`, 8 kB
 * compressed). Brotli quality 5: per request, a few times smaller than gzip's cost at the top quality, and close to it in size.
 */
export const compressed = async (response: Response, acceptEncoding: string | null): Promise<Response> => {
    const encoding = encodingFor(acceptEncoding);
    const type = response.headers.get('content-type') ?? '';
    if (response.headers.has('content-encoding') || !/^text\/(?:html|markdown)/i.test(type)) return response;
    const headers = new Headers(response.headers);
    // A cache must keep the encodings apart even for a client that took none.
    headers.append('vary', 'Accept-Encoding');
    const body = new Uint8Array(await response.arrayBuffer());
    if (encoding === undefined || body.byteLength < MIN_BYTES) return new Response(body, { status: response.status, statusText: response.statusText, headers });
    const packed = encoding === 'br' ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : gzipSync(body);
    headers.set('content-encoding', encoding);
    headers.set('content-length', String(packed.byteLength));
    return new Response(new Uint8Array(packed), { status: response.status, statusText: response.statusText, headers });
};
