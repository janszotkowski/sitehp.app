import { BAD_SITE, GOOD_SITE, MISSING_SITE, expect, finalScore, startScan, test } from './app.ts';

test('a scan of a good site shows live progress, then the verdict and the score', async ({ page }) => {
    await startScan(page, GOOD_SITE);
    await expect(page.getByRole('progressbar', { name: 'Scan progress' })).toBeVisible();
    const score = await finalScore(page);
    expect(score).toBeGreaterThanOrEqual(90);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    const categories = page.getByRole('region', { name: 'Score by category' });
    await expect(categories.getByRole('button', { name: /^Security: \d+ out of 100$/ })).toBeVisible();
    await expect(categories.getByRole('button', { name: /^SEO: \d+ out of 100$/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: GOOD_SITE })).toBeVisible();
    await expect(page.getByText(/^(Everything that was checked is in good shape\.|One thing is worth a look\.|\d+ things are worth a look\.)$/).first()).toBeVisible();
    await expect(page.getByRole('table', { name: `All checks for ${GOOD_SITE}` }).getByRole('rowheader')).not.toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    // The share preview is this report's own image, a PNG drawn from its score.
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(image).toMatch(/\/og\/r\/[\w-]+\.png$/);
    const preview = await page.request.get(new URL(new URL(image ?? '').pathname, page.url()).href);
    expect(preview.status()).toBe(200);
    expect(preview.headers()['content-type']).toBe('image/png');
});

test('Scan again starts a new scan of the same site', async ({ page }) => {
    await startScan(page, GOOD_SITE);
    await finalScore(page);
    const first = page.url();
    await page.getByRole('button', { name: 'Scan again' }).click();
    await expect(page).not.toHaveURL(first);
    await expect(page).toHaveURL(/\/en\/r\/[\w-]+$/);
    await finalScore(page);
});

test('a scan of a bad site shows its failures and a lower score', async ({ page }) => {
    await startScan(page, BAD_SITE);
    const score = await finalScore(page);
    expect(score).toBeLessThan(60);
    const table = page.getByRole('table', { name: `All checks for ${BAD_SITE}` });
    for (const title of ['Mixed content', 'Page title']) {
        await expect(table.getByRole('row', { name: new RegExp(title) })).toContainText('Failed');
    }
});

test('a site that does not answer ends in a readable failure', async ({ page }) => {
    await startScan(page, MISSING_SITE);
    await expect(page.getByText('The scan could not be completed. The website could not be reached. Check the address and try again.').first()).toBeVisible();
});

test('a site behind a bot wall gets no score, and the report says the site blocked the scanner', async ({ page }) => {
    await startScan(page, 'www.acme-tickets.example');
    await expect(page.getByText(/^The site turned the scanner away \(HTTP 403\)/).first()).toBeVisible();
    await expect(page.getByText('Blocked', { exact: true }).first()).toBeVisible();
});

test('an article behind a cookie consent wall is not judged by the consent page', async ({ page }) => {
    await startScan(page, 'www.zpravy-acme.example/domaci/zastupitele-schvalili-novy-park-41234');
    const score = await finalScore(page);
    expect(score).toBeGreaterThan(0);
    // A finished report starts on what needs attention; the check in question may be one that passed.
    await page.getByRole('button', { name: /^All \d+$/ }).click();
    const table = page.getByRole('table', { name: /^All checks for / });
    await expect(table.getByRole('row', { name: /Page title/ })).not.toContainText('Failed');
});

test('a second submit while a scan starts is ignored, and the focus stays on the held button', async ({ page }) => {
    const scans: string[] = [];
    page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/scans') scans.push(request.url());
    });
    // Hold the start of the scan, so the pending state can be looked at.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(
        (url) => url.pathname === '/v1/scans',
        async (route) => {
            await held;
            await route.fallback();
        },
    );

    await page.goto('/en');
    const field = page.getByLabel('Website to scan');
    const button = page.getByRole('button', { name: /^(Scan|Starting…)$/ });
    await field.fill(GOOD_SITE);
    await button.click();
    await expect(button).toHaveText('Starting…');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toBeFocused();
    // Playwright refuses to click an aria-disabled button; force it, since a person's click still reaches it.
    await button.click({ force: true });
    await field.press('Enter');
    release();

    await expect(page).toHaveURL(/\/en\/r\/[\w-]+$/);
    expect(scans).toHaveLength(1);
});
