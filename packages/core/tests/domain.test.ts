import { domainToASCII, domainToUnicode as nodeDomainToUnicode } from 'node:url';
import { describe, expect, it } from 'vitest';
import { displayUrl, domainToUnicode } from '@src/index.ts';

const NAMES = ['háčky.cz', 'příliš-žluťoučký.cz', 'müller.de', 'bücher.example.com', 'españa.com', 'президент.рф', '日本語.jp', 'ελλάδα.gr', 'a.b-c.example'];

describe('domainToUnicode', () => {
    it('decodes what the URL parser encoded, the same as Node does', () => {
        for (const name of NAMES) {
            const ascii = new URL(`https://${name}/`).hostname;
            expect(domainToUnicode(ascii)).toBe(nodeDomainToUnicode(ascii));
        }
    });

    it('gives back the name a person typed', () => {
        expect(domainToUnicode(domainToASCII('příliš-žluťoučký.cz'))).toBe('příliš-žluťoučký.cz');
    });

    it('leaves plain ASCII names alone', () => {
        expect(domainToUnicode('example.com')).toBe('example.com');
        expect(domainToUnicode('sub.example.co.uk')).toBe('sub.example.co.uk');
    });

    it('leaves a label that is not valid punycode as it is, instead of throwing', () => {
        for (const label of ['xn--', 'xn--abc-', 'xn--a', 'xn--zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'xn--ab$c', 'xn--ä-ab']) {
            expect(domainToUnicode(`${label}.cz`)).toBe(`${label}.cz`);
        }
    });
});

describe('displayUrl', () => {
    it('shows the host in Unicode and keeps the path and the query', () => {
        const ascii = new URL('https://háčky.cz/').hostname;
        expect(ascii.startsWith('xn--')).toBe(true);
        expect(displayUrl(`https://${ascii}/kontakt?a=1`)).toBe('https://háčky.cz/kontakt?a=1');
    });

    it('returns an ASCII address and a non-URL unchanged', () => {
        expect(displayUrl('https://example.com/')).toBe('https://example.com/');
        expect(displayUrl('not a url')).toBe('not a url');
    });
});
