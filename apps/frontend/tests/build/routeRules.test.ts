import { describe, expect, it } from 'vitest';
import { REPORT_HEADERS } from '@lib/reportHeaders';
import { securityHeaders } from '@lib/securityHeaders';
import { nitroServerOptions, routeRules } from '@vite/routeRules';

describe('routeRules', () => {
    const rules = routeRules(true);

    it('gives every static file the shared security headers, without a CSP (built per page)', () => {
        expect(rules['/**']?.headers).toEqual(securityHeaders());
        expect(rules['/**']?.headers).not.toHaveProperty('Content-Security-Policy');
    });

    it('caches hashed build output, fonts included, for a year', () => {
        expect(rules['/assets/**']?.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    });

    it('revalidates every page, the bare language root too', () => {
        for (const route of ['/en', '/en/**']) expect(rules[route]?.headers['Cache-Control'], route).toBe('public, max-age=0, must-revalidate');
    });

    it('keeps the stricter headers of report pages over the shared ones', () => {
        expect(rules['/en/r/**']?.headers).toEqual(REPORT_HEADERS);
    });

    it('keeps static files out of the index while indexing is off, and only then', () => {
        expect(routeRules(false)['/**']?.headers['X-Robots-Tag']).toBe('noindex, nofollow');
        expect(rules['/**']?.headers).not.toHaveProperty('X-Robots-Tag');
    });
});

describe('nitroServerOptions', () => {
    it('applies the rules and precompresses static files in a production build', () => {
        expect(nitroServerOptions('build', true)).toEqual({ routeRules: routeRules(true), compressPublicAssets: { gzip: true, brotli: true } });
    });

    it('leaves the dev server alone', () => {
        expect(nitroServerOptions('serve', true)).toEqual({});
    });
});
