import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: { tsconfigPaths: true },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        // An in-memory Postgres (PGlite) boots and migrates per test; on a busy CI runner that alone can pass Vitest's 5 s default.
        testTimeout: 20_000,
    },
});
