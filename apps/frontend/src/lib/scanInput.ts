import { MAX_URL_LENGTH, normalizeUrl, type UrlRejection } from '@sitehp.app/core/browser';

export { MAX_URL_LENGTH };

/**
 * What the form knows about what the person typed. A pure function of the text, so it is the
 * same on every keystroke and easy to test. It applies the rules of the server (`normalizeUrl`)
 * and nothing more: the server stays the authority, this only spares a round trip and tells
 * the person early what is wrong and what will actually be scanned.
 */
export type ScanInputState = { kind: 'empty' } | { kind: 'invalid'; reason: UrlRejection } | { kind: 'valid'; href: string; host: string };

export const checkScanInput = (value: string): ScanInputState => {
    if (value.trim() === '') return { kind: 'empty' };
    const result = normalizeUrl(value);
    return result.ok ? { kind: 'valid', href: result.url.href, host: result.url.host } : { kind: 'invalid', reason: result.reason };
};

/**
 * An address from the API that is safe to use as a link target. The backend only stores http(s)
 * addresses, but the page must not depend on that: a `javascript:` or `data:` URL in an `href`
 * would run in the visitor's browser. Anything that is not plain http(s) gets no link at all.
 */
export const safeExternalHref = (value: string): string | undefined => {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
    } catch {
        return undefined;
    }
};
