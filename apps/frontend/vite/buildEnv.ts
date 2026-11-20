import { DEFAULT_SITE_ORIGIN } from '../src/config/origin.ts';

/**
 * A build for the production origin with indexing off would ship every page as `noindex`, and
 * nobody would notice until the site dropped out of search. Such a build fails instead: a build
 * for production sets `VITE_ALLOW_INDEXING=true`, any other build sets its own `VITE_SITE_URL`.
 */
export const requireIndexingDecision = (env: Readonly<Record<string, string | undefined>>): void => {
    const origin = (env['VITE_SITE_URL'] || DEFAULT_SITE_ORIGIN).replace(/\/$/, '');
    if (origin === DEFAULT_SITE_ORIGIN && env['VITE_ALLOW_INDEXING'] !== 'true') {
        throw new Error(
            `This build is for ${DEFAULT_SITE_ORIGIN} but VITE_ALLOW_INDEXING is not "true", so every page would be noindex. Set VITE_ALLOW_INDEXING=true for production, or VITE_SITE_URL to this environment's own origin (see apps/frontend/.env.example).`,
        );
    }
};
