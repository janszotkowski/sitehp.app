import { GOOD_SITE, expect, finalScore, rowButton, startScan, test } from './app.ts';

test.beforeEach(async ({ page }) => {
    await startScan(page, GOOD_SITE);
    await finalScore(page);
});

test('a category narrows the table, the passed checks are one tap away, and search filters', async ({ page }) => {
    const count = page.getByText(/^\d+ of \d+ checks$/);
    // A finished report starts on what needs attention, or on everything when nothing does.
    await page.getByRole('button', { name: /^All \d+$/ }).click();
    const total = Number(/of (\d+)/.exec((await count.textContent()) ?? '')?.[1]);
    const security = page.getByRole('button', { name: /^Security: \d+ out of 100/ });

    await expect(security).toHaveAttribute('aria-pressed', 'false');
    await security.click();
    await expect(security).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Showing only Security.')).toBeVisible();
    await expect(rowButton(page, 'Page title')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show all categories' }).click();
    await expect(security).toHaveAttribute('aria-pressed', 'false');
    await expect(count).toHaveText(`${total} of ${total} checks`);

    await page.getByRole('searchbox', { name: 'Search checks' }).fill('page title');
    await expect(rowButton(page, 'Page title')).toBeVisible();
    await expect(rowButton(page, 'Mixed content')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(count).toHaveText(`${total} of ${total} checks`);
});

test('a row opens the detail, j/k and arrows step, Escape closes and focus returns', async ({ page }) => {
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeHidden();

    await rowButton(page, 'Page title').click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { level: 2, name: 'Page title' })).toBeVisible();
    const position = drawer.getByText(/^\d+ of \d+$/);
    const start = Number(/^\d+/.exec((await position.textContent()) ?? '')?.[0]);

    await page.keyboard.press('j');
    await expect(position).toHaveText(new RegExp(`^${start + 1} of`));
    await expect(drawer.getByRole('heading', { level: 2, name: 'Page title' })).toHaveCount(0);
    await page.keyboard.press('k');
    await expect(position).toHaveText(new RegExp(`^${start} of`));
    await page.keyboard.press('ArrowDown');
    await expect(position).toHaveText(new RegExp(`^${start + 1} of`));
    await page.keyboard.press('ArrowUp');
    await expect(drawer.getByRole('heading', { level: 2, name: 'Page title' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(rowButton(page, 'Page title')).toBeFocused();
});

test('the open detail is a modal that fits the screen', async ({ page }) => {
    await rowButton(page, 'Page title').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // It fades in: wait until it is fully opaque before measuring.
    await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
    const box = await dialog.boundingBox();
    const view = page.viewportSize();
    expect(box).not.toBeNull();
    if (box === null || view === null) return;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
});
