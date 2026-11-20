import { urlForLog, type Logger } from '@platform/logger.ts';
import { connect } from 'node:tls';
import type { Transform } from 'node:stream';
import type { PeerCertificate } from 'node:tls';
import { constants as zlibConstants, createBrotliDecompress, createGunzip, createInflate, createZstdDecompress } from 'node:zlib';
import { normalizeUrl, type CertificateInfo, type FetchedPage, type ScanFailureReason } from '@sitehp.app/core';
import { Agent, buildConnector, request } from 'undici';
import { BlockedAddressError, createGuardedLookup, type GuardedLookupOptions } from '@platform/net/guarded-lookup.ts';
import { registrableDomain } from '@platform/net/registrable-domain.ts';

export type SafeFetchOptions = GuardedLookupOptions & {
    /** The whole fetch, redirects included. */
    timeoutMs: number;
    /** Bytes read from the final response; the rest is dropped and `truncated` is set. */
    maxBytes: number;
    maxRedirects: number;
    userAgent: string;
    /** Tests only: a local test server listens on a custom port. Never set from configuration. */
    allowCustomPorts?: boolean;
    /** Where the fetch tells what it did and what it refused. Never given a query string or a body. */
    logger?: Pick<Logger, 'debug' | 'warn'>;
    /** Hosts the fetcher must never go to, on top of the internal-address rules (the block list). */
    isHostBlocked?: (host: string) => boolean;
    /** Current time in ms, for the days a certificate has left. Defaults to the system clock. */
    now?: () => number;
};

/** What a page is asked for by default: HTML, as a browser would. */
const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';

/** The encodings `decoderFor` reads, in the order a browser lists them: what the `compression` check needs to see a server compress. */
const ACCEPT_ENCODING = 'gzip, deflate, br, zstd';

export type SafeFetchResult = { ok: true; page: FetchedPage } | { ok: false; reason: ScanFailureReason };

export type SafeFetcher = {
    /** `stayOnSite`: a redirect to another registrable domain is not followed, and the fetch answers `unreachable` (see `SiteFetcher`). */
    fetchPage: (url: string, signal?: AbortSignal, accept?: string, stayOnSite?: boolean) => Promise<SafeFetchResult>;
    /** The certificate a host presents on port 443, whether or not it is trusted; `null` when no TLS answers. */
    inspectCertificate: (host: string) => Promise<CertificateInfo | null>;
    close: () => Promise<void>;
};

/**
 * The decompressor for a `Content-Encoding`, `null` when the body is plain, `'unsupported'` for what is not read (several
 * encodings stacked, or one we do not know).
 */
const decoderFor = (encoding: string | undefined): Transform | null | 'unsupported' => {
    switch (encoding?.trim().toLowerCase()) {
        case undefined:
        case '':
        case 'identity':
            return null;
        case 'gzip':
        case 'x-gzip':
            return createGunzip();
        case 'deflate':
            return createInflate();
        case 'br':
            return createBrotliDecompress();
        case 'zstd':
            // The default window (up to 128 MB) lets a tiny frame demand a huge allocation; 8 MB is what browsers accept.
            return createZstdDecompress({ params: { [zlibConstants.ZSTD_d_windowLogMax]: 23 } });
        default:
            return 'unsupported';
    }
};

/** What a peer certificate says, `null` when it carries no readable expiry (a malformed `valid_to` would make `toISOString` throw). */
export const certificateInfoOf = (certificate: Partial<PeerCertificate>, authorized: boolean, authorizationError: Error | undefined, now: number): CertificateInfo | null => {
    if (typeof certificate.valid_to !== 'string') return null;
    const validTo = new Date(certificate.valid_to);
    if (Number.isNaN(validTo.getTime())) return null;
    const issuer = certificate.issuer?.O ?? certificate.issuer?.CN ?? '';
    return {
        authorized,
        error: authorized ? null : String(authorizationError),
        validTo: validTo.toISOString(),
        daysLeft: Math.floor((validTo.getTime() - now) / 86_400_000),
        issuer: (Array.isArray(issuer) ? issuer.join(', ') : issuer).slice(0, 100),
    };
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TEXT_TYPE = /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|javascript))/i;
const TLS_ERROR_CODES = new Set([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_NOT_YET_VALID',
    'CERT_UNTRUSTED',
]);
const TIMEOUT_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT']);

const codeOf = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null) return undefined;
    const direct = (error as { code?: unknown }).code;
    if (typeof direct === 'string') return direct;
    const cause = (error as { cause?: unknown }).cause;
    return cause === undefined ? undefined : codeOf(cause);
};

const reasonOf = (error: unknown): ScanFailureReason => {
    if (error instanceof BlockedAddressError || (typeof error === 'object' && error !== null && 'cause' in error && (error as { cause?: unknown }).cause instanceof BlockedAddressError))
        return 'blocked_address';
    const code = codeOf(error);
    if (code === 'ESITEHP_BLOCKED') return 'blocked_address';
    if (code !== undefined && (TIMEOUT_CODES.has(code) || code === 'ABORT_ERR')) return 'timeout';
    if (code !== undefined && (TLS_ERROR_CODES.has(code) || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL'))) return 'tls_error';
    if (code !== undefined && (code.startsWith('HPE_') || code === 'UND_ERR_RESPONSE' || code === 'UND_ERR_INVALID_ARG')) return 'invalid_response';
    return 'unreachable';
};

/** Compressed bytes read from the wire at most, as a multiple of `maxBytes`: a body that decompresses to almost nothing cannot stream for ever. */
const RAW_BYTES_FACTOR = 4;

/**
 * The text encoding of a body: the `charset` of `Content-Type`, else a `<meta charset>` or `<meta http-equiv="content-type" content="…; charset=…">`
 * in the first 1024 bytes (where HTML says it must be), else UTF-8. A label the decoder does not know counts as UTF-8.
 */
export const textEncodingOf = (contentType: string | null, body: Uint8Array): string => {
    const declared = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(Buffer.from(body.subarray(0, 1024)).toString('latin1'))?.[1];
    try {
        return new TextDecoder(declared ?? 'utf-8').encoding;
    } catch {
        return 'utf-8';
    }
};

const decodeText = (contentType: string | null, body: Buffer): string => new TextDecoder(textEncodingOf(contentType, body)).decode(body);

const flattenHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string> => {
    const flat: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) flat[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
    }
    return flat;
};

/**
 * Fetches one page on behalf of a stranger's request without ever reaching the
 * network the scanner runs in. The protections, each of which has its own test:
 *
 * - **Where it may go.** Only http and https, only the default ports, no user name in
 *   the URL, no IP literals, no single-label hosts (`normalizeUrl`, applied to the first
 *   URL and to every redirect target).
 * - **What a name may resolve to.** Only public addresses, checked in the connection's own
 *   lookup (no gap for DNS rebinding), and for every redirect hop too.
 * - **No automatic redirects.** They are followed here, one hop at a time, up to a limit,
 *   and each hop goes through the same checks.
 * - **Limits.** One timeout for the whole fetch, a cap on the bytes read, a cap on redirects.
 * - **No identity.** No cookies, no credentials, no proxy settings; a fixed User-Agent.
 *
 * It is one layer. All scanner traffic should also leave through an egress proxy that
 * enforces the same rules at the network level (see the architecture).
 */
export const createSafeFetcher = (options: SafeFetchOptions): SafeFetcher => {
    // The protocol each host's connection negotiated (ALPN), kept for `FetchedPage.alpn`. Capped so a long-lived fetcher does not grow with every host it has seen.
    const alpnByHost = new Map<string, string>();
    const connector = buildConnector({ lookup: createGuardedLookup(options), timeout: Math.min(options.timeoutMs, 10_000), preferH2: true });
    const agent = new Agent({
        connect: (opts, callback) =>
            connector(opts, (error, socket) => {
                const protocol = (socket as { alpnProtocol?: string | false } | null)?.alpnProtocol;
                if (!error && typeof protocol === 'string') {
                    if (alpnByHost.size >= 500) alpnByHost.delete(alpnByHost.keys().next().value as string);
                    alpnByHost.set(opts.hostname, protocol);
                }
                callback(error as Error, socket as never);
            }),
        headersTimeout: options.timeoutMs,
        bodyTimeout: options.timeoutMs,
        // One-shot connections: a scan is a handful of requests to a stranger's server.
        pipelining: 0,
    });

    const allowedTarget = (url: string): string | undefined => {
        const normalized = normalizeUrl(url);
        if (normalized.ok) return normalized.url.href;
        // A custom port is refused unless a test server needs one. Even then every other rule still
        // applies: the URL is checked again without its port, so an IP literal cannot hide behind it.
        if (normalized.reason === 'CUSTOM_PORT' && options.allowCustomPorts === true) {
            const withoutPort = new URL(url);
            withoutPort.port = '';
            return normalizeUrl(withoutPort.href).ok ? new URL(url).href : undefined;
        }
        return undefined;
    };

    // A host on the block list is refused like an internal address, at the first address and at every redirect.
    const target = (url: string): string | undefined => {
        const href = allowedTarget(url);
        return href === undefined || options.isHostBlocked?.(new URL(href).hostname) === true ? undefined : href;
    };

    const fetchPage = async (input: string, outerSignal?: AbortSignal, accept = HTML_ACCEPT, stayOnSite = false): Promise<SafeFetchResult> => {
        const startedAt = performance.now();
        const timeout = AbortSignal.timeout(options.timeoutMs);
        const signal = outerSignal === undefined ? timeout : AbortSignal.any([timeout, outerSignal]);
        const redirects: Array<{ from: string; to: string; status: number }> = [];
        let current = input;

        for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
            const href = target(current);
            if (href === undefined) {
                options.logger?.warn({ ...urlForLog(current), hop, rule: allowedTarget(current) === undefined ? 'address_rules' : 'block_list' }, 'fetch refused');
                return { ok: false, reason: 'blocked_address' };
            }

            const requestedAt = performance.now();
            try {
                const response = await request(href, {
                    method: 'GET',
                    dispatcher: agent,
                    signal,
                    headers: { 'user-agent': options.userAgent, accept, 'accept-encoding': ACCEPT_ENCODING },
                });
                // Destroying a body we do not need reports an abort on the stream; nobody is listening for it.
                response.body.on('error', () => undefined);
                const ttfbMs = Math.round(performance.now() - requestedAt);
                const location = response.headers['location'];

                if (REDIRECT_STATUSES.has(response.statusCode) && typeof location === 'string') {
                    response.body.destroy();
                    let next: string;
                    try {
                        next = new URL(location, href).href;
                    } catch {
                        return { ok: false, reason: 'invalid_response' };
                    }
                    // A side probe (robots.txt, the sitemap, …) is not sent on to a stranger's server: the scan would make it a request someone else chose.
                    if (stayOnSite && registrableDomain(new URL(next).hostname) !== registrableDomain(new URL(href).hostname)) {
                        options.logger?.debug({ ...urlForLog(next), hop, rule: 'off_site_redirect' }, 'fetch refused');
                        return { ok: false, reason: 'unreachable' };
                    }
                    redirects.push({ from: href, to: next, status: response.statusCode });
                    current = next;
                    continue;
                }

                const headers = flattenHeaders(response.headers);
                const setCookie = response.headers['set-cookie'];
                const cookies = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
                const contentType = headers['content-type'] ?? null;
                const decoder = decoderFor(headers['content-encoding']);
                const isText = contentType !== null && TEXT_TYPE.test(contentType) && decoder !== 'unsupported';
                // The cap counts what comes out of the decompressor, so a small file that inflates enormously (a "zip bomb") is cut like any big page.
                // What comes off the wire is capped too, so a body that inflates to almost nothing cannot keep the fetch reading.
                let sourceFailed = false;
                let rawCapped = false;
                let raw = 0;
                let source: AsyncIterable<unknown> = response.body;
                if (decoder !== null && decoder !== 'unsupported') {
                    // `pipe` does not carry an error of the network to the decompressor, so a dropped connection would leave the loop below waiting.
                    response.body.on('error', (error) => {
                        sourceFailed = true;
                        decoder.destroy(error);
                    });
                    // Registered before `pipe`, so the chunk that crosses the cap still reaches the decompressor; then it gets nothing more and
                    // finishes what it has (cut-off input ends in an error, handled below).
                    response.body.on('data', (chunk: Buffer) => {
                        raw += chunk.length;
                        if (rawCapped || raw <= options.maxBytes * RAW_BYTES_FACTOR) return;
                        rawCapped = true;
                        response.body.unpipe(decoder);
                        response.body.pause();
                        process.nextTick(() => decoder.end());
                    });
                    source = response.body.pipe(decoder);
                }

                const chunks: Buffer[] = [];
                let bytes = 0;
                let truncated = false;
                try {
                    for await (const chunk of source) {
                        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
                        const room = options.maxBytes - bytes;
                        if (buffer.length > room) {
                            if (isText && room > 0) chunks.push(buffer.subarray(0, room));
                            bytes += Math.max(room, 0);
                            truncated = true;
                            break;
                        }
                        if (isText) chunks.push(buffer);
                        bytes += buffer.length;
                    }
                } catch (error) {
                    // A body that cannot be decompressed (corrupt data) is not a failed scan: the page is kept without a readable body.
                    // A dropped connection (with or without a decompressor), a timeout or the caller's abort is still one.
                    if (signal.aborted || sourceFailed || decoder === null || decoder === 'unsupported') throw error;
                    // Over the cap of compressed bytes the input was cut on purpose: the page keeps what was read, like one over `maxBytes`.
                    if (!rawCapped) {
                        chunks.length = 0;
                        bytes = 0;
                    }
                }
                response.body.destroy();
                if (decoder !== null && decoder !== 'unsupported') decoder.destroy();
                if (rawCapped) truncated = true;

                return {
                    ok: true,
                    page: {
                        finalUrl: href,
                        status: response.statusCode,
                        redirects,
                        headers,
                        cookies,
                        contentType,
                        body: isText ? decodeText(contentType, Buffer.concat(chunks)) : '',
                        bytes,
                        // Without a decompressor what was read is what was on the wire.
                        transferredBytes: decoder === null || decoder === 'unsupported' ? bytes : raw,
                        truncated,
                        ttfbMs,
                        alpn: alpnByHost.get(new URL(href).hostname) ?? null,
                        totalMs: Math.round(performance.now() - startedAt),
                    },
                };
            } catch (error) {
                // The caller's own abort is not a timeout; ours is.
                if (timeout.aborted) return { ok: false, reason: 'timeout' };
                const reason = reasonOf(error);
                // A name that resolves to an internal address is what a hostile site or a DNS trick looks like: worth a warning.
                if (reason === 'blocked_address') options.logger?.warn({ ...urlForLog(href), hop, rule: 'resolves_to_internal_address' }, 'fetch refused');
                return { ok: false, reason };
            }
        }

        return { ok: false, reason: 'too_many_redirects' };
    };

    /**
     * Reads the certificate without trusting it, through the same guarded lookup as every fetch.
     * Nothing is sent: the connection is closed as soon as the handshake ends.
     */
    const inspectCertificate = (host: string): Promise<CertificateInfo | null> =>
        new Promise((resolve) => {
            // The same address rules as a fetch: an IP literal would skip the guarded lookup altogether.
            if (!normalizeUrl(`https://${host}/`).ok) return resolve(null);
            const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: false, lookup: createGuardedLookup(options), timeout: options.timeoutMs });
            const done = (info: CertificateInfo | null) => {
                clearTimeout(deadline);
                socket.destroy();
                resolve(info);
            };
            // `timeout` above only fires on silence; a server that trickles the handshake is stopped by this deadline.
            const deadline = setTimeout(() => done(null), options.timeoutMs);
            socket.once('secureConnect', () => {
                // A throw in this listener would be an uncaught exception that ends the process.
                try {
                    done(certificateInfoOf(socket.getPeerCertificate(), socket.authorized, socket.authorizationError, (options.now ?? Date.now)()));
                } catch {
                    done(null);
                }
            });
            socket.once('error', () => done(null));
            socket.once('timeout', () => done(null));
        });

    /** One line per fetch: where, what came back and how long it took. */
    const loggedFetchPage = async (input: string, outerSignal?: AbortSignal, accept?: string, stayOnSite?: boolean): Promise<SafeFetchResult> => {
        const startedAt = performance.now();
        const result = await fetchPage(input, outerSignal, accept, stayOnSite);
        const durationMs = Math.round(performance.now() - startedAt);
        const asked = { ...urlForLog(input), accept: accept === undefined ? 'html' : accept };
        if (!result.ok) options.logger?.debug({ ...asked, reason: result.reason, durationMs }, 'fetch failed');
        else {
            const { page } = result;
            options.logger?.debug(
                {
                    ...asked,
                    status: page.status,
                    redirects: page.redirects.length,
                    finalHost: urlForLog(page.finalUrl).host,
                    bytes: page.bytes,
                    truncated: page.truncated,
                    contentType: page.contentType,
                    ttfbMs: page.ttfbMs,
                    durationMs,
                },
                'fetch',
            );
        }
        return result;
    };

    return { fetchPage: loggedFetchPage, inspectCertificate, close: () => agent.close() };
};
