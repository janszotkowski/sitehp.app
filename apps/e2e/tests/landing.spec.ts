import { expect, test } from './app.ts';

test('/ redirects to /en and shows the scan form', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByLabel('Website to scan')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
});

test('an invalid address shows the inline message and starts no scan', async ({ page }) => {
    const scans: string[] = [];
    page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/scans') scans.push(request.url());
    });
    await page.goto('/en');
    // The message element is there before any message, so a screen reader is already watching it when one arrives.
    const message = page.locator('#scan-url-error');
    await expect(message).toBeEmpty();
    await page.getByLabel('Website to scan').fill('localhost');
    await page.getByRole('button', { name: 'Scan', exact: true }).click();
    await expect(message).toHaveText('Use a public domain name, such as example.com.');
    await expect(page.getByLabel('Website to scan')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/en$/);
    expect(scans).toEqual([]);
});

test('an unknown report id is a 404 page', async ({ page }) => {
    const response = await page.goto(`/en/r/${'a'.repeat(22)}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Report not found or expired' })).toBeVisible();
});

test.describe('theme', () => {
    // A visitor whose system prefers light: the site still starts dark, and only the button changes that.
    test.use({ colorScheme: 'light' });

    test('the theme button switches to the light theme and the choice survives a reload', async ({ page }) => {
        await page.goto('/en/about');
        const html = page.locator('html');
        await expect(html).toHaveClass(/\bdark\b/);
        await page.getByRole('button', { name: 'Switch to light theme' }).click();
        await expect(html).not.toHaveClass(/\bdark\b/);
        await page.reload();
        await expect(html).not.toHaveClass(/\bdark\b/);
        await page.getByRole('button', { name: 'Switch to dark theme' }).click();
        await expect(html).toHaveClass(/\bdark\b/);
    });
});
