/** A scan target after validation: what every check receives. */
export type ScanUrl = {
    /** Canonical absolute URL: lower-case host, no fragment. */
    href: string;
    scheme: 'http' | 'https';
    /** ASCII host (punycode for international names). */
    host: string;
    path: string;
};

export type UrlRejection = 'EMPTY' | 'TOO_LONG' | 'INVALID' | 'UNSUPPORTED_SCHEME' | 'CREDENTIALS' | 'CUSTOM_PORT' | 'HOST_NOT_ALLOWED';

export type NormalizeUrlResult = { ok: true; url: ScanUrl } | { ok: false; reason: UrlRejection };

export const MAX_URL_LENGTH = 2048;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Turns what a person typed into a scan target, or says why it cannot be one.
 * `example.com` becomes `https://example.com/`. This is syntax only: it keeps
 * out the obvious mistakes (other schemes, credentials in the URL, IP literals,
 * single-label hosts such as `localhost`, custom ports). Resolving the host and
 * blocking internal addresses is the job of the fetching layer (F0-9), which
 * must not trust this function.
 */
export const normalizeUrl = (input: string): NormalizeUrlResult => {
    const trimmed = input.trim();
    if (trimmed === '') return { ok: false, reason: 'EMPTY' };
    if (trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: 'TOO_LONG' };

    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    let parsed: URL;
    try {
        parsed = new URL(withScheme);
    } catch {
        return { ok: false, reason: 'INVALID' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'UNSUPPORTED_SCHEME' };
    if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'CREDENTIALS' };
    if (parsed.port !== '') return { ok: false, reason: 'CUSTOM_PORT' };

    const host = parsed.hostname;
    const isIpv6 = host.startsWith('[');
    if (host === '' || isIpv6 || IPV4.test(host) || !host.includes('.') || host.endsWith('.')) return { ok: false, reason: 'HOST_NOT_ALLOWED' };

    parsed.hash = '';
    return {
        ok: true,
        url: { href: parsed.href, scheme: parsed.protocol === 'https:' ? 'https' : 'http', host, path: `${parsed.pathname}${parsed.search}` },
    };
};

/**
 * An address or a path with the value of every query parameter replaced by `…`: `/reset?token=…&lang=…`. What a report may
 * show of an address a person typed (or a page redirected to), since a query can carry a token or a session.
 */
export const hideQueryValues = (address: string): string => {
    const start = address.indexOf('?');
    if (start === -1) return address;
    const query = address
        .slice(start + 1)
        .replace(/#.*$/, '')
        .split('&')
        .map((pair) => (pair.includes('=') ? `${pair.slice(0, pair.indexOf('='))}=…` : pair))
        .join('&');
    return `${address.slice(0, start)}?${query}`;
};
