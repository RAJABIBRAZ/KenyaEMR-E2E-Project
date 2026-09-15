import { expect, test, type Page } from '@playwright/test';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const UAT_ORIGIN = 'https://uat.kenyahmis.org';
const LOGIN_URL = `${UAT_ORIGIN}/openmrs/spa/login`;
const HOME_URL = `${UAT_ORIGIN}/openmrs/spa/home`;
const LANDING_PATH = '/openmrs/spa/home/registration';
const FORM_URL = `${UAT_ORIGIN}/openmrs/spa/patient-registration`;

function readReadOnlyCredentials() {
  const configured = process.env.KENYAEMR_PERF_ENV_FILE;
  if (!configured || !isAbsolute(configured)) {
    throw new Error('Set KENYAEMR_PERF_ENV_FILE to an absolute path for the read-only UAT audit account.');
  }
  const content = readFileSync(realpathSync(configured), 'utf8');
  const value = (key: string) => content.split(/\r?\n/).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim() ?? '';
  const rawUrl = value('KENYAEMR_URL').match(/https?:\/\/\S+/)?.[0];
  const username = value('KENYAEMR_USERNAME').replace(/^username\s*:\s*/i, '');
  const password = value('KENYAEMR_PASSWORD').replace(/^password\s*:\s*/i, '');
  if (!rawUrl || !username || !password) throw new Error('Read-only UAT credential file lacks required KENYAEMR_* values.');
  const url = new URL(rawUrl);
  if (
    url.origin !== UAT_ORIGIN || url.pathname !== '/openmrs/spa/login' ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error('Read-only registration smoke tests must target the approved UAT login, never another environment.');
  }
  return { username, password };
}

async function loginReadOnly(page: Page) {
  const { username, password } = readReadOnlyCredentials();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 });
  if (new URL(page.url()).origin !== UAT_ORIGIN) throw new Error('Login left the approved UAT origin.');
  if (new URL(page.url()).pathname.endsWith('/login/location')) {
    // Session-location selection changes only the current login session.
    const firstLocation = page.locator('input[type="radio"][name="loginLocations"]').first();
    await firstLocation.waitFor({ state: 'attached' });
    await firstLocation.evaluate((element) => (element as HTMLInputElement).click());
    await page.getByRole('button', { name: /confirm/i }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login/location'), { timeout: 15_000 });
  }
  if (new URL(page.url()).pathname.includes('/login/otp')) {
    throw new Error('The read-only account requires OTP; these checks cannot continue noninteractively.');
  }
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`a[href="${LANDING_PATH}"]`)).toBeVisible();
}

test.describe('UAT Registration read-only smoke checks', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.KENYAEMR_PERF_ENV_FILE, 'Set an explicit read-only UAT credential file to run.');
    await loginReadOnly(page);
  });

  test('TC041 | 03_Registration!R2 | sidebar opens client registry verification', async ({ page }) => {
    await page.locator(`a[href="${LANDING_PATH}"]`).click();
    await expect(page).toHaveURL(`${UAT_ORIGIN}${LANDING_PATH}`);
    await expect(page.getByText(/client registry/i).first()).toBeVisible();
  });

  test('TC054 partial | 03_Registration!R15 | blank name fields are required before save', async ({ page }) => {
    test.info().annotations.push({
      type: 'scope',
      description: 'Pre-submit only; workbook Save click and validation-message assertions are not executed.',
    });
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(FORM_URL);
    for (const selector of ['#givenName', '#familyName']) {
      const field = page.locator(selector);
      await expect(field).toBeVisible();
      await expect(field).toHaveAttribute('required', '');
      expect(await field.evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
    }
    await expect(page.getByRole('button', { name: 'Register patient', exact: true })).toBeVisible();
    // No Save/Register click: this account has no patient-write authorization.
  });

  test('TC041 partial | 03_Registration!R23 | patient form sections and actions are present', async ({ page }) => {
    test.info().annotations.push({
      type: 'scope',
      description: 'Direct form navigation and visible controls only; not every workbook field or indicator is covered.',
    });
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(FORM_URL);
    for (const section of ['1. Basic Info', '2. Contact Details', '3. Demographics', '7. Next of Kin']) {
      await expect(page.getByText(section, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Register patient', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  });

  test('TC054 partial | 03_Registration!R32 | gender radios switch before save', async ({ page }) => {
    test.info().annotations.push({
      type: 'scope',
      description: 'Current-form Male/Female radios only; workbook expects a dropdown with Other and saved selection.',
    });
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(FORM_URL);
    const male = page.locator('#gender-option-male');
    const female = page.locator('#gender-option-female');
    await male.waitFor({ state: 'attached' });
    await female.waitFor({ state: 'attached' });
    await male.evaluate((element) => (element as HTMLInputElement).click());
    await expect(male).toBeChecked();
    await expect(female).not.toBeChecked();
    await female.evaluate((element) => (element as HTMLInputElement).click());
    await expect(female).toBeChecked();
    await expect(male).not.toBeChecked();
    // No Save/Register click or patient record write.
  });

  test('TC055 partial | 03_Registration!R33 | address fields are visible before save', async ({ page }) => {
    test.info().annotations.push({
      type: 'scope',
      description: 'Pre-submit field presence only; hierarchical selection and saved-address assertions are not executed.',
    });
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(FORM_URL);
    for (const selector of ['#countyDistrict', '#stateProvince', '#address4', 'input[name="address.cityVillage"]']) {
      await expect(page.locator(selector)).toBeVisible();
    }
  });

  test('TC062 partial | 03_Registration!R36 | Cancel returns to the previous page without a patient POST', async ({ page }) => {
    test.info().annotations.push({
      type: 'scope',
      description: 'Synthetic unsaved form only; workbook confirmation prompt and persisted-record absence are not established.',
    });
    const previousPage = page.url();
    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(FORM_URL);
    await page.locator('#givenName').fill('QaAutomation');
    await page.locator('#familyName').fill('SyntheticCancel');
    let patientPosts = 0;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === UAT_ORIGIN && request.method() === 'POST' && /patient|registr/i.test(url.pathname)) {
        patientPosts += 1;
      }
    });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(previousPage);
    await page.waitForTimeout(1000); // Allow any delayed cancellation request to be observed.
    expect(patientPosts, 'Cancel should not issue a patient registration POST').toBe(0);
  });
});
