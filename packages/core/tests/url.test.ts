import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH, hideQueryValues, normalizeUrl } from '@src/scan/url.ts';

const ok = (input: string) => {
    const result = normalizeUrl(input);
    if (!result.ok) throw new Error(`expected ${input} to be accepted, got ${result.reason}`);
    return result.url;
};

describe('normalizeUrl', () => {
    it('adds https to a bare domain', () => {
        expect(ok('example.com')).toEqual({ href: 'https://example.com/', scheme: 'https', host: 'example.com', path: '/' });
    });

    it('keeps http as http, lower-cases the host and drops the fragment', () => {
        expect(ok(' HTTP://Example.COM/Path?x=1#frag ')).toEqual({ href: 'http://example.com/Path?x=1', scheme: 'http', host: 'example.com', path: '/Path?x=1' });
    });

    it('turns an international host into punycode', () => {
        expect(ok('https://bücher.example').host).toBe('xn--bcher-kva.example');
    });

    it.each([
        ['', 'EMPTY'],
        ['   ', 'EMPTY'],
        ['ftp://example.com', 'UNSUPPORTED_SCHEME'],
        ['javascript://example.com/%0Aalert(1)', 'UNSUPPORTED_SCHEME'],
        ['https://user:pass@example.com', 'CREDENTIALS'],
        ['https://example.com:8443', 'CUSTOM_PORT'],
        ['localhost', 'HOST_NOT_ALLOWED'],
        ['http://127.0.0.1', 'HOST_NOT_ALLOWED'],
        ['http://192.168.1.10/admin', 'HOST_NOT_ALLOWED'],
        ['http://[::1]/', 'HOST_NOT_ALLOWED'],
        ['internal', 'HOST_NOT_ALLOWED'],
        ['https://', 'INVALID'],
        ['http://exa mple.com', 'INVALID'],
    ])('rejects %j as %s', (input, reason) => {
        expect(normalizeUrl(input)).toEqual({ ok: false, reason });
    });

    it('rejects an address that is too long', () => {
        expect(normalizeUrl(`https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`)).toEqual({ ok: false, reason: 'TOO_LONG' });
    });
});

describe('hideQueryValues', () => {
    it('keeps the query keys and hides every value, for an address or a path', () => {
        expect(hideQueryValues('https://a.com/reset?token=s3cret&lang=en&debug#top')).toBe('https://a.com/reset?token=…&lang=…&debug');
        expect(hideQueryValues('/p?id=1')).toBe('/p?id=…');
        expect(hideQueryValues('https://a.com/')).toBe('https://a.com/');
    });
});
