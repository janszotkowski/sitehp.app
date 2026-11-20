import { describe, expect, it } from 'vitest';
import { requireIndexingDecision } from '@vite/buildEnv';

describe('requireIndexingDecision', () => {
    it('refuses a production build that would ship noindex', () => {
        expect(() => requireIndexingDecision({ VITE_SITE_URL: 'https://sitehp.app', VITE_ALLOW_INDEXING: 'false' })).toThrow(/VITE_ALLOW_INDEXING/);
        expect(() => requireIndexingDecision({ VITE_SITE_URL: 'https://sitehp.app/' })).toThrow();
    });

    it('treats a missing origin as the production one', () => {
        expect(() => requireIndexingDecision({})).toThrow();
    });

    it('lets production with indexing and any other origin through', () => {
        expect(() => requireIndexingDecision({ VITE_SITE_URL: 'https://sitehp.app', VITE_ALLOW_INDEXING: 'true' })).not.toThrow();
        expect(() => requireIndexingDecision({ VITE_SITE_URL: 'http://localhost:3000', VITE_ALLOW_INDEXING: 'false' })).not.toThrow();
        expect(() => requireIndexingDecision({ VITE_SITE_URL: 'https://staging.sitehp.app' })).not.toThrow();
    });
});
