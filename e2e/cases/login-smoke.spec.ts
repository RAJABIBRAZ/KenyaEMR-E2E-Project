import { expect, test } from '@playwright/test';

function qaLoginUrl(): string {
  const raw = process.env.KENYAEMR_URL ?? process.env.E2E_BASE_URL;
  if (!raw) {
    throw new Error('Set KENYAEMR_URL to the QA instance URL before running login smoke tests.');
  }

  const supplied = new URL(raw);
  const spaIndex = supplied.pathname.indexOf('/spa');
  const contextPath = spaIndex >= 0 ? supplied.pathname.slice(0, spaIndex) : supplied.pathname.replace(/\/$/, '');
  return new URL(`${contextPath}/spa/login`, supplied.origin).href;
}

test.describe('TaifaCare anonymous login smoke checks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(qaLoginUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#username')).toBeVisible();
  });

  test('TC001 | 01_Login!R2 | scoped login page elements are visible', async ({ page }) => {
    test.info().annotations.push({
      type: 'scope',
      description: 'Password recovery is excluded from this run; source workbook TC001 remains broader.',
    });
    await expect(page.getByRole('img', { name: 'Logo', exact: true })).toBeVisible();
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /log in|sign in/i })).toBeVisible();
    await expect(page.getByRole('img', { name: 'KenyaEMR', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'DHA', exact: true })).toBeVisible();
  });

  test('TC002 | 01_Login!R3 | login page does not require vertical scrolling', async ({ page }) => {
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#username')).toBeVisible();
      for (const name of ['KenyaEMR', 'DHA']) {
        const image = page.getByRole('img', { name, exact: true });
        await expect(image).toBeVisible();
        const bottom = await image.evaluate((element) => element.getBoundingClientRect().bottom);
        expect.soft(bottom, `${name} footer image is below the ${viewport.width}x${viewport.height} viewport`).toBeLessThanOrEqual(
          viewport.height + 2,
        );
      }
      const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      expect.soft(documentHeight, `Login page scrolls at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(
        viewport.height + 2,
      );
    }
  });

  test('TC006 | 01_Login!R7 | empty credentials are blocked by form validation', async ({ page }) => {
    const username = page.locator('#username');
    const password = page.locator('#password');
    await expect(username).toHaveValue('');
    await expect(password).toHaveValue('');
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(qaLoginUrl());
    expect(await username.evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect(await password.evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect(await username.evaluate((element) => (element as HTMLInputElement).validationMessage)).not.toBe('');
  });

  test('TC007 | 01_Login!R8 | password entry remains masked', async ({ page }) => {
    const password = page.locator('#password');
    await expect(password).toHaveAttribute('type', 'password');
    await password.fill('not-a-real-password');
    await expect(password).toHaveValue('not-a-real-password');
    await expect(password).toHaveAttribute('type', 'password');
  });
});
