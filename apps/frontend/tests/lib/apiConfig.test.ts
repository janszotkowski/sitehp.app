import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from '@config/api';

describe('resolveApiBaseUrl', () => {
    it('calls the public origin from the browser, even when an internal one exists', () => {
        expect(resolveApiBaseUrl({ ssr: false, publicUrl: 'https://api.sitehp.app', internalUrl: 'http://backend:4000' })).toBe('https://api.sitehp.app');
    });

    it('prefers the internal origin on the server', () => {
        expect(resolveApiBaseUrl({ ssr: true, publicUrl: 'https://api.sitehp.app', internalUrl: 'http://backend:4000' })).toBe('http://backend:4000');
    });

    it('falls back to the public origin on the server when no internal one is set', () => {
        expect(resolveApiBaseUrl({ ssr: true, publicUrl: 'https://api.sitehp.app', internalUrl: undefined })).toBe('https://api.sitehp.app');
        expect(resolveApiBaseUrl({ ssr: true, publicUrl: 'https://api.sitehp.app', internalUrl: '' })).toBe('https://api.sitehp.app');
    });

    it('drops a trailing slash so paths join cleanly', () => {
        expect(resolveApiBaseUrl({ ssr: false, publicUrl: 'https://api.sitehp.app/', internalUrl: undefined })).toBe('https://api.sitehp.app');
    });
});

describe('turbo.json', () => {
    // Turbo runs tasks in strict mode: a variable it is not told about never reaches the process.
    it.each(['start', 'dev'])('lets the API addresses through to `pnpm %s`', (task) => {
        const turbo = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../turbo.json'), 'utf8')) as { tasks: Record<string, { passThroughEnv?: string[] }> };
        expect(turbo.tasks[task]?.passThroughEnv).toEqual(expect.arrayContaining(['API_INTERNAL_URL', 'VITE_*', 'PORT', 'HOST']));
    });
});
