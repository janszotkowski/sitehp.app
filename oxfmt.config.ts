import { defineConfig } from 'oxfmt';

export default defineConfig({
    printWidth: 200,
    singleQuote: true,
    trailingComma: 'all',
    arrowParens: 'always',
    bracketSpacing: true,
    bracketSameLine: false,
    tabWidth: 4,
    singleAttributePerLine: true,
    ignorePatterns: [
        'dist',
        'build',
        '.output',
        'node_modules',
        '.tanstack',
        '.turbo',
        '**/paraglide',
        '**/routeTree.gen.ts',
        'docs',
        '.claude',
        'pnpm-lock.yaml',
        'AGENTS.md',
        'apps/backend/demo-sites/**/*.html',
        'apps/backend/tests/__snapshots__',
    ],
});
