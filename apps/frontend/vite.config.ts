import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, loadEnv, type UserConfig } from 'vite';

import { requireIndexingDecision } from './vite/buildEnv.ts';
import { dropUseClientDirectiveWarning } from './vite/logs.ts';
import { paraglideOptions } from './vite/paraglide.ts';
import { getTanstackStartPages } from './vite/pages.ts';
import { nitroServerOptions } from './vite/routeRules.ts';
import { originFilesPlugin } from './vite/originFiles.ts';
import { sitemapPlugin } from './vite/sitemap.ts';

/**
 * The browser's API address is baked into the bundle at build time. Without it the app falls
 * back to `http://localhost:4000`, which is right while developing and silently wrong anywhere
 * else: every visitor would get "cannot reach the server". A build therefore refuses to start
 * without it (`pnpm env:init` creates a local `.env` that has it).
 */
const requireApiUrl = (env: Record<string, string>): void => {
    if ((env['VITE_API_URL'] ?? '').trim() === '') {
        throw new Error('VITE_API_URL is not set. A build bakes the API address into the bundle; set it (see apps/frontend/.env.example) or run `pnpm env:init` for a local build.');
    }
};

const createConfig = (command: 'build' | 'serve', allowIndexing: boolean) =>
    ({
        server: {
            port: 3000,
        },
        // The prerender step of a build opens a preview server and fetches the pages from it. By the name `localhost` that fails in a container
        // (the server binds to ::1, the fetch goes to 127.0.0.1), so it is pinned to the address.
        preview: {
            host: '127.0.0.1',
        },
        resolve: {
            tsconfigPaths: true,
        },
        plugins: [
            sitemapPlugin(),
            originFilesPlugin(),
            tanstackStart({
                pages: getTanstackStartPages(),
                prerender: {
                    enabled: true,
                    crawlLinks: false,
                    autoStaticPathsDiscovery: false,
                },
                // The sitemap is built by `sitemapPlugin` from the same page list:
                // the generator built into Start wrote it after Nitro had assembled
                // the list of public files.
                sitemap: {
                    enabled: false,
                },
            }),
            nitro({
                // Static files (robots.txt, scripts, styles, images) never reach `src/server.ts`; the route rules give them the same headers, and the cache policy.
                ...nitroServerOptions(command, allowIndexing),
                rolldownConfig: { onLog: dropUseClientDirectiveWarning },
                // The share-image renderer loads from node_modules as published: bundled, harfbuzz (inside satori) asks for `__dirname`, which an ES module lacks; `*` copies its whole package, `hb.wasm` included.
                traceDeps: ['satori', 'harfbuzzjs*'],
            }),
            viteReact(),
            tailwindcss(),
            paraglideVitePlugin(paraglideOptions),
        ],
    }) satisfies UserConfig;

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    if (command === 'build') {
        requireApiUrl(env);
        requireIndexingDecision(env);
    }
    return createConfig(command, env['VITE_ALLOW_INDEXING'] === 'true');
});
