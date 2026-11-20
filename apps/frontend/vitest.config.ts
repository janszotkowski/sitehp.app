import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: { tsconfigPaths: true },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        env: { VITE_ALLOW_INDEXING: 'true', VITE_SITE_URL: 'https://sitehp.app' },
    },
});
