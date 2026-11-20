import { GOOD_SITE, expect, finalScore, rowButton, startScan, test } from './app.ts';

test('on a phone a row opens the bottom sheet, and Escape or Close dismisses it', async ({ page }) => {
    await startScan(page, GOOD_SITE);
    await finalScore(page);
    const sheet = page.getByRole('dialog', { name: 'Page title' });

    await rowButton(page, 'Page title').click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await rowButton(page, 'Page title').click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
});

test('on a phone the Menu button opens a full-screen menu; Escape, the X and Close close it and give the focus back', async ({ page }) => {
    await page.goto('/en');
    const button = page.getByRole('button', { name: 'Menu' });
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeHidden();

    await button.click();
    await expect(menu.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'How scoring works' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await menu.getByRole('button', { name: 'Close menu' }).click();
    await expect(menu).toBeHidden();

    await button.click();
    await menu.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(menu).toBeHidden();

    await button.click();
    await menu.getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/en\/about\/?$/);
    await expect(menu).toBeHidden();
});
