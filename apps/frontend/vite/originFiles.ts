import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { DEFAULT_SITE_ORIGIN } from '../src/config/origin.ts';

const ORIGIN = (process.env.VITE_SITE_URL ?? DEFAULT_SITE_ORIGIN).replace(/\/$/, '');

/** Files at the site root whose addresses must be absolute. Written for the production origin in `vite/templates/`. */
const FILES = ['robots.txt', 'llms.txt'] as const;

/** A template with every production address moved to `origin`, so a staging build never publishes the production URLs. */
export const withOrigin = (template: string, origin: string = ORIGIN): string => template.replaceAll(DEFAULT_SITE_ORIGIN, origin);

export const originFile = (name: (typeof FILES)[number], origin: string = ORIGIN): string => withOrigin(readFileSync(new URL(`./templates/${name}`, import.meta.url), 'utf8'), origin);

/**
 * `robots.txt` and `llms.txt` for the origin of this build (`VITE_SITE_URL`), emitted as client-build assets like the
 * sitemap (`vite/sitemap.ts`) and served by a dev middleware.
 */
export const originFilesPlugin = (): Plugin => {
    return {
        name: 'sitehp-origin-files',
        applyToEnvironment: (environment) => environment.name === 'client',
        generateBundle() {
            for (const name of FILES) this.emitFile({ type: 'asset', fileName: name, source: originFile(name) });
        },
        configureServer(server) {
            for (const name of FILES) {
                server.middlewares.use(`/${name}`, (_request, response) => {
                    response.setHeader('content-type', 'text/plain; charset=utf-8');
                    response.end(originFile(name));
                });
            }
        },
    };
};
