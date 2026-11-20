import type { CompilerOptions } from '@inlang/paraglide-js';

/**
 * The single description of localized URLs. The Vite plugin, the `i18n:compile`
 * script and the tests all read it, so there is no second copy to drift.
 * A new language is one more `localized` entry and one more entry in
 * `src/lib/i18n/switchLocalePath.ts`.
 */
export const paraglideOptions = {
    project: './project.inlang',
    outdir: './src/paraglide',
    outputStructure: 'message-modules',
    strategy: ['url', 'preferredLanguage', 'baseLocale'],
    isServer: "import.meta.env?.SSR ?? typeof window === 'undefined'",
    urlPatterns: [
        {
            pattern: '/:path(.*)?',
            localized: [
                ['en', '/en/:path(.*)?'],
                ['cs', '/cs/:path(.*)?'],
            ],
        },
    ],
} satisfies CompilerOptions;
