import { describe, expect, it } from 'vitest';
import { redirectFor } from '@lib/i18n/negotiate';

const req = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Request(`https://sitehp.app${path}`, { method, headers });

describe('redirectFor', () => {
    it('sends the root to English with a temporary redirect, whatever language the browser asks for', () => {
        for (const acceptLanguage of ['en-US', 'cs-CZ,cs;q=0.9', '']) {
            const response = redirectFor(req('/', acceptLanguage === '' ? {} : { 'accept-language': acceptLanguage }));
            expect(response?.status).toBe(302);
            expect(response?.headers.get('location')).toBe('/en');
            expect(response?.headers.get('vary')).toBeNull();
        }
    });

    it('keeps the query string', () => {
        expect(redirectFor(req('/?utm=x'))?.headers.get('location')).toBe('/en?utm=x');
    });

    it('merges a trailing slash into the canonical address permanently', () => {
        const response = redirectFor(req('/en/'));
        expect(response?.status).toBe(301);
        expect(response?.headers.get('location')).toBe('/en');
    });

    it('sends the prerendered file name and a trailing slash to the canonical address permanently', () => {
        for (const path of ['/en/about/', '/en/about/index.html']) {
            const response = redirectFor(req(path));
            expect(response?.status).toBe(301);
            expect(response?.headers.get('location')).toBe('/en/about');
        }
        expect(redirectFor(req('/en/index.html'))?.headers.get('location')).toBe('/en');
        expect(redirectFor(req('//example.com/index.html'))?.headers.get('location')).toBe('/example.com');
    });

    it('never turns a double slash into a foreign address', () => {
        expect(redirectFor(req('//example.com/'))?.headers.get('location')).toBe('/example.com');
    });

    it('leaves other methods and normal addresses alone', () => {
        expect(redirectFor(req('/', {}, 'POST'))).toBeNull();
        expect(redirectFor(req('/en/pricing'))).toBeNull();
    });
});
