import { test as base, expect, type Page } from '@playwright/test';

/** The e2e servers (see `playwright.config.ts`). */
const BACKEND = 'http://127.0.0.1:4160';
const FRONTEND = 'http://127.0.0.1:3160';

/** Demo sites in `apps/backend/demo-sites` (`e2e-good`, `e2e-bad`): a site in good shape, one with clear faults, and one no demo site answers for. */
export const GOOD_SITE = 'example.com';
export const BAD_SITE = 'example.org';
export const MISSING_SITE = 'example.net';

/**
 * The browser calls the API address baked into the frontend build (`VITE_API_URL`). When that is not the e2e backend
 * (a local build points at `pnpm dev`'s backend), its `/v1/` calls are answered by the e2e backend instead.
 * shortcut: a forwarded event stream arrives in one piece once the scan ends, so the progress is only seen live when
 * the build points at the e2e backend (CI builds it so).
 */
export const test = base.extend({
    context: async ({ context }, use) => {
        await context.route(
            (url) => url.pathname.startsWith('/v1/') && url.origin !== BACKEND && url.origin !== FRONTEND,
            async (route) => {
                const url = new URL(route.request().url());
                const response = await route.fetch({ url: `${BACKEND}${url.pathname}${url.search}` });
                await route.fulfill({ response });
            },
        );
        await use(context);
        // A test may end while a forwarded event stream is still open; that request no longer matters.
        await context.unrouteAll({ behavior: 'ignoreErrors' });
    },
});

export { expect };

/** Starts a scan from the landing page's form and waits for its report page. */
export const startScan = async (page: Page, site: string): Promise<void> => {
    await page.goto('/en');
    await page.getByLabel('Website to scan').fill(site);
    await page.getByRole('button', { name: 'Scan', exact: true }).click();
    await expect(page).toHaveURL(/\/en\/r\/[\w-]+$/);
};

/** Waits for the scan to finish and returns its HP score, read from the score ring's label. */
export const finalScore = async (page: Page): Promise<number> => {
    await expect(page.getByText(/^Scan complete · \d+ checks$/)).toBeVisible();
    const label = await page.getByRole('img', { name: /^HP score \d+ out of 100$/ }).getAttribute('aria-label');
    return Number(/\d+/.exec(label ?? '')?.[0]);
};

/** The button in a check's row of the report table, found by the check's name. */
export const rowButton = (page: Page, title: string) => page.getByRole('rowheader', { name: new RegExp(`^${title}`) }).getByRole('button');
