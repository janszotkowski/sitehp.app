import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * The built backend and frontend, started as production would run them (like `tools/smoke.js`), with the
 * scanner answering from the demo sites in `apps/backend/demo-sites` instead of the network. Run `pnpm build` first.
 * The ports differ from `pnpm dev` (3000/4000) and the smoke test (3150/4150), so all three can run at once.
 */
// Kept in step with BACKEND and FRONTEND in tests/app.ts.
const BACKEND_PORT = 4160;
const FRONTEND_PORT = 3160;
const backend = `http://127.0.0.1:${BACKEND_PORT}`;
const frontend = `http://127.0.0.1:${FRONTEND_PORT}`;
const root = fileURLToPath(new URL('../..', import.meta.url));
const ci = process.env['CI'] !== undefined && process.env['CI'] !== '';
// Locally, the installed Google Chrome (kept up to date by itself) in its sandbox, not Playwright's own Chromium,
// which lags behind Chrome's security fixes and runs without a sandbox. CI keeps the downloaded Chromium.
const chrome = ci ? {} : { channel: 'chrome', launchOptions: { chromiumSandbox: true } };

const demoSites = fileURLToPath(new URL('../backend/demo-sites', import.meta.url));

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: ci,
    retries: ci ? 1 : 0,
    reporter: ci ? 'list' : [['list'], ['html', { open: 'never' }]],
    timeout: 20_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: frontend,
        trace: 'on-first-retry',
        locale: 'en-US',
        ...chrome,
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
        // The report opens a check in a bottom sheet below 1024px.
        { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
    ],
    webServer: [
        {
            command: 'node apps/backend/dist/main.api.mjs',
            cwd: root,
            url: `${backend}/v1/health`,
            reuseExistingServer: false,
            timeout: 30_000,
            env: {
                NODE_ENV: 'test',
                HOST: '127.0.0.1',
                PORT: String(BACKEND_PORT),
                LOG_LEVEL: 'silent',
                CORS_ORIGINS: frontend,
                SITE_FETCHER_REPLAY_DIR: demoSites,
                SCAN_LIMIT_PER_IP: '100000',
                SCAN_LIMIT_PER_DOMAIN: '100000',
                // Every test scans its site anew (the tests run the same sites over and over).
                SCAN_REUSE_MS: '0',
                // Slow enough that the live progress can be seen, fast enough that a scan takes about two seconds.
                SCAN_STEP_DELAY_MS: '50',
            },
        },
        {
            command: 'node apps/frontend/.output/server/index.mjs',
            cwd: root,
            url: `${frontend}/en`,
            reuseExistingServer: false,
            timeout: 30_000,
            env: { HOST: '127.0.0.1', PORT: String(FRONTEND_PORT), API_INTERNAL_URL: backend },
        },
    ],
});
