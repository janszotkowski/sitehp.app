import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH, checkScanInput, safeExternalHref } from '@lib/scanInput';

describe('checkScanInput', () => {
    it('is empty for nothing or only spaces, so the form says nothing while the person has not started', () => {
        expect(checkScanInput('')).toEqual({ kind: 'empty' });
        expect(checkScanInput('   ')).toEqual({ kind: 'empty' });
    });

    it('accepts a bare domain and shows what will really be scanned', () => {
        expect(checkScanInput('example.com')).toEqual({ kind: 'valid', href: 'https://example.com/', host: 'example.com' });
        expect(checkScanInput('  Example.COM/Pricing#top  ')).toEqual({ kind: 'valid', href: 'https://example.com/Pricing', host: 'example.com' });
    });

    it.each([
        ['ftp://example.com', 'UNSUPPORTED_SCHEME'],
        ['https://user:pw@example.com', 'CREDENTIALS'],
        ['example.com:8080', 'CUSTOM_PORT'],
        ['localhost', 'HOST_NOT_ALLOWED'],
        ['192.168.0.1', 'HOST_NOT_ALLOWED'],
        ['http://[::1]/', 'HOST_NOT_ALLOWED'],
        ['exa mple.com', 'INVALID'],
    ])('rejects %j as %s, the same rule the server applies', (value, reason) => {
        expect(checkScanInput(value)).toEqual({ kind: 'invalid', reason });
    });

    it('rejects an address longer than the field allows', () => {
        expect(checkScanInput(`example.com/${'a'.repeat(MAX_URL_LENGTH)}`)).toEqual({ kind: 'invalid', reason: 'TOO_LONG' });
    });
});

describe('safeExternalHref', () => {
    it('links http and https addresses', () => {
        expect(safeExternalHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
        expect(safeExternalHref('http://example.com')).toBe('http://example.com/');
    });

    it.each([
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        'ftp://example.com',
        '//example.com',
        'example.com',
        '',
    ])('gives %j no link at all', (value) => {
        expect(safeExternalHref(value)).toBeUndefined();
    });
});
