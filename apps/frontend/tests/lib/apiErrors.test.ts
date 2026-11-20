import { ApiError } from '@sitehp.app/core/browser';
import { describe, expect, it } from 'vitest';
import { failureCodeOf } from '@lib/apiErrors';

describe('failureCodeOf', () => {
    it('reads the code of an API error', () => {
        expect(failureCodeOf(new ApiError('RATE_LIMITED', 'slow down', 429))).toBe('RATE_LIMITED');
    });

    it('calls a request that got no answer a network failure', () => {
        expect(failureCodeOf(new TypeError('Failed to fetch'))).toBe('NETWORK');
        expect(failureCodeOf(new TypeError('fetch failed'))).toBe('NETWORK');
        expect(failureCodeOf(new TypeError('NetworkError when attempting to fetch resource.'))).toBe('NETWORK');
        expect(failureCodeOf(new TypeError('Load failed'))).toBe('NETWORK');
        expect(failureCodeOf(new TypeError('Failed to fetch dynamically imported module: /assets/scanStart.js'))).toBe('NETWORK');
        expect(failureCodeOf(new DOMException('The operation was aborted.', 'AbortError'))).toBe('NETWORK');
    });

    it('calls anything else an internal failure, so a bug in the page is not shown as a lost connection', () => {
        expect(failureCodeOf(new TypeError("Cannot read properties of undefined (reading 'fetch')"))).toBe('INTERNAL');
        expect(failureCodeOf(new Error('render failed'))).toBe('INTERNAL');
        expect(failureCodeOf({ name: 'ApiError', code: 'INTERNAL' })).toBe('INTERNAL');
        expect(failureCodeOf(undefined)).toBe('INTERNAL');
    });
});
