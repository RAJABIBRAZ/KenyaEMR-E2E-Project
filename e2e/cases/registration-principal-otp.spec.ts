import { expect, test, type Page } from '@playwright/test';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';

const UAT_ORIGIN = 'https://uat.kenyahmis.org';
const LOGIN_URL = `${UAT_ORIGIN}/openmrs/spa/login`;
const REGISTRATION_URL = `${UAT_ORIGIN}/openmrs/spa/home/registration`;
const PROJECT_ROOT = process.cwd();

function readOwnerOnlyFile(configured: string | undefined, label: string) {
  if (!configured || !isAbsolute(configured)) {
    throw new Error(`${label} must be an absolute path outside this Git repository.`);
  }
  const path = realpathSync(configured);
  if (path === PROJECT_ROOT || path.startsWith(PROJECT_ROOT + sep)) {
    throw new Error(`${label} must not be stored in this Git repository.`);
  }
  const stat = statSync(path);
  if (!stat.isFile() || stat.mode & 0o077) {
    throw new Error(`${label} must be an owner-only regular file (chmod 600).`);
  }
  return readFileSync(path, 'utf8');
}

function readFixture() {
  const credentials = readOwnerOnlyFile(process.env.KENYAEMR_PERF_ENV_FILE, 'UAT credential file');
  const value = (key: string) => credentials.split(/\r?\n/).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim() ?? '';
  const url = new URL(value('KENYAEMR_URL'));
  if (url.origin !== UAT_ORIGIN || !['/', '/openmrs', '/openmrs/spa/login'].includes(url.pathname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('UAT credential file must target the approved OpenMRS login origin.');
  }
  const username = value('KENYAEMR_USERNAME').replace(/^username\s*:\s*/i, '');
  const password = value('KENYAEMR_PASSWORD').replace(/^password\s*:\s*/i, '');
  if (!username || !password) throw new Error('UAT credential file is missing the username or password.');

  const idFile = process.env.QA_E2E_PRINCIPAL_ID_FILE;
  const idFromCredentials = value('QA_E2E_PRINCIPAL_NATIONAL_ID');
  if (idFile && idFromCredentials) {
    throw new Error('Set the approved principal ID in either the credential file or a separate ID file, not both.');
  }
  const nationalId = idFile ? readOwnerOnlyFile(idFile, 'Principal-member ID file').trim() : idFromCredentials;
  if (!/^\d{8}$/.test(nationalId)) {
    throw new Error('The approved principal-member fixture must contain one 8-digit National ID.');
  }
  return { username, password, nationalId };
}

async function login(page: Page, username: string, password: string) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => url.pathname !== '/openmrs/spa/login', { timeout: 30_000 });
  if (new URL(page.url()).origin !== UAT_ORIGIN) throw new Error('Login left the approved UAT origin.');

  if (new URL(page.url()).pathname.endsWith('/login/location')) {
    const location = page.locator('input[type="radio"][name="loginLocations"]').first();
    await location.waitFor({ state: 'attached' });
    await location.evaluate((element) => (element as HTMLInputElement).click());
    await page.getByRole('button', { name: /confirm/i }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login/location'), { timeout: 15_000 });
  }
  if (new URL(page.url()).pathname.includes('/login/otp')) {
    throw new Error('Staff login OTP is separate from principal-member verification and needs its own test setup.');
  }
}

test('03_Registration!R3/R4/R6/R8/R9 partial | principal ID lookup and assisted OTP', async ({ page }) => {
  test.skip(
    process.env.QA_E2E_PRINCIPAL_OTP_APPROVED !== 'true',
    'Principal lookup and OTP delivery are disabled until the synthetic fixture and test destination are approved.',
  );
  test.info().annotations.push({
    type: 'scope',
    description: 'Current-UI principal lookup and human-assisted OTP gate; not full HIE details, SMS delivery, Check In, dependent action, patient save, or visit creation.',
  });
  const { username, password, nationalId } = readFixture();
  await login(page, username, password);

  await page.goto(REGISTRATION_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(REGISTRATION_URL);
  await page.locator('#formIdentifierType').click();
  await page.getByRole('option', { name: 'National ID', exact: true }).click();
  await expect(page.locator('#formIdentifierType')).toHaveValue('National ID');
  // UAT leaves focus on a Carbon action after selection; Escape releases its focus trap.
  await page.keyboard.press('Escape');
  const identifierNumber = page.locator('#formSearchHealthWorkers');
  await identifierNumber.click();
  await identifierNumber.fill(nationalId);
  await expect(identifierNumber).toHaveValue(nationalId);
  const search = page.getByRole('button', { name: 'Search for Patient(s)', exact: true });
  await expect(search).toBeEnabled();
  await search.click();

  const sendOtp = page.getByRole('button', { name: 'Send OTP', exact: true });
  const enterOtp = page.getByRole('button', { name: 'Enter OTP', exact: true });
  const verify = page.getByRole('button', { name: 'Verify', exact: true });
  const checkIn = page.getByRole('button', { name: 'Check In', exact: true });
  await expect(sendOtp.or(enterOtp).or(verify).or(checkIn).first()).toBeVisible({ timeout: 45_000 });
  if (await checkIn.isVisible() && !await sendOtp.isVisible() && !await enterOtp.isVisible() && !await verify.isVisible()) {
    throw new Error('This principal is already verified in UAT; use a fixture that still requires OTP.');
  }
  // The Send OTP action can open the modal while Enter OTP remains visible behind its overlay.
  if (!await verify.isVisible() && await page.locator('.omrs-modals-container button:visible').count() === 0) {
    if (await sendOtp.isVisible()) {
      await sendOtp.click();
    } else if (await enterOtp.isVisible()) {
      await enterOtp.click();
    }
  }
  console.info('Complete any test-phone confirmation in Chrome; the test will wait for the OTP Verify step.');
  await expect(verify).toBeVisible({ timeout: 30_000 });
  console.info('Enter the current OTP in the Chrome window and click Verify. Do not paste the ID or OTP into the terminal.');

  // The operator supplies the one-time code. A dismissed/failed prompt will not pass the final UI assertions.
  await expect(verify).toBeHidden({ timeout: 3 * 60 * 1000 });
  await expect(checkIn).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show dependents', exact: true })).toBeVisible();
  await expect(enterOtp).toBeHidden();
});
