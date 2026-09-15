import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';
import { extractPatientIdentity, extractPatientUuidFromUrl } from '../helpers/registration-identity';
import { recordUatPatientEvent } from '../helpers/uat-patient-tracker';

const UAT_ORIGIN = 'https://uat.kenyahmis.org';
const LOGIN_URL = `${UAT_ORIGIN}/openmrs/spa/login`;
const REGISTRATION_URL = `${UAT_ORIGIN}/openmrs/spa/patient-registration`;
const PROJECT_ROOT = process.cwd();
const READ_ONLY_ACCOUNT_FILE = '/home/rajab/.config/kenyaemr/uat-perf.env';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readRegistrationCredentials() {
  const configured = process.env.QA_E2E_REGISTRATION_ENV_FILE;
  if (!configured || !isAbsolute(configured)) {
    throw new Error('Set QA_E2E_REGISTRATION_ENV_FILE to an absolute path for a dedicated write-enabled QA account.');
  }
  const path = realpathSync(configured);
  const readOnlyPath = existsSync(READ_ONLY_ACCOUNT_FILE) ? realpathSync(READ_ONLY_ACCOUNT_FILE) : READ_ONLY_ACCOUNT_FILE;
  if (path === readOnlyPath || path.startsWith(PROJECT_ROOT + sep)) {
    throw new Error('Registration credentials must not reuse the read-only audit file or live inside this Git repository.');
  }
  if (statSync(path).mode & 0o077) {
    throw new Error('Registration credential file must be owner-only; run chmod 600 on the file.');
  }

  const content = readFileSync(path, 'utf8');
  const value = (key: string) => content.split(/\r?\n/).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim() ?? '';
  const rawUrl = value('KENYAEMR_URL');
  const username = value('KENYAEMR_USERNAME').replace(/^username\s*:\s*/i, '');
  const password = value('KENYAEMR_PASSWORD').replace(/^password\s*:\s*/i, '');
  if (!rawUrl || !username || !password) throw new Error('Dedicated registration credential file lacks required KENYAEMR_* values.');

  const url = new URL(rawUrl);
  if (
    url.origin !== UAT_ORIGIN ||
    !['/', '/openmrs', '/openmrs/spa/login'].includes(url.pathname) ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error('Dedicated registration credential file must target the exact UAT OpenMRS login origin.');
  }
  return { username, password };
}

function assertWriteOptIn() {
  if (process.env.QA_E2E_ALLOW_WRITES !== 'true' || process.env.QA_E2E_REGISTRATION_APPROVED !== 'true') {
    throw new Error('Synthetic UAT registration requires both explicit write and registration approval flags.');
  }
  if (process.env.QA_E2E_DATA_PREFIX !== 'QAE2E' || !process.env.QA_E2E_RUN_ID) {
    throw new Error('Set QA_E2E_DATA_PREFIX=QAE2E and one QA_E2E_RUN_ID before registering.');
  }
}

async function loginWithDedicatedAccount(page: Page, username: string, password: string) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => url.pathname !== '/openmrs/spa/login', { timeout: 30_000 });
  if (new URL(page.url()).origin !== UAT_ORIGIN) throw new Error('Login left the approved UAT origin.');

  if (new URL(page.url()).pathname.endsWith('/login/location')) {
    const locationUuid = process.env.QA_E2E_LOCATION_UUID;
    if (!locationUuid || !UUID.test(locationUuid)) {
      throw new Error('This account requires a session location; set an approved QA_E2E_LOCATION_UUID.');
    }
    const location = page.locator(`input[type="radio"][name="loginLocations"][value="${locationUuid}"]`);
    await location.waitFor({ state: 'attached' });
    await location.evaluate((element) => (element as HTMLInputElement).click());
    await expect(location).toBeChecked();
    await page.getByRole('button', { name: /confirm/i }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login/location'), { timeout: 15_000 });
  }
  if (new URL(page.url()).pathname.includes('/login/otp')) {
    throw new Error('This account requires OTP; noninteractive registration cannot continue.');
  }
}

test('TC059 partial | 03_Registration!R20 | record the ID UAT assigns to one synthetic registration', async ({ page }) => {
  test.skip(
    process.env.QA_E2E_ALLOW_WRITES !== 'true' || process.env.QA_E2E_REGISTRATION_APPROVED !== 'true',
    'UAT patient creation is disabled until separately authorized and explicitly opted in.',
  );
  test.info().annotations.push({
    type: 'scope',
    description: 'Partial TC059: one approved synthetic registration and assigned-ID capture; not the full workflow.',
  });
  assertWriteOptIn();
  const credentials = readRegistrationCredentials();
  const surnameSuffix = Array.from(randomBytes(8), (byte) => String.fromCharCode(65 + (byte % 26))).join('');
  const fixtureKey = `QAE2E-REG-${surnameSuffix}`;
  let saveAttempted = false;
  let observedUuid: string | undefined;
  let confirmedIdentifier: string | undefined;
  let failureCode = 'SAVE_RESPONSE_NOT_OBSERVED';

  await loginWithDedicatedAccount(page, credentials.username, credentials.password);
  await page.goto(REGISTRATION_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(REGISTRATION_URL);
  await page.locator('#givenName').fill('QaAutomation');
  await page.locator('#familyName').fill(`Synthetic${surnameSuffix}`);
  await page.locator('#gender-option-male').evaluate((element) => (element as HTMLInputElement).click());
  await page.locator('input[name="birthdate"]').fill('1990-01-01');
  const register = page.getByRole('button', { name: 'Register patient', exact: true });
  await expect(register).toBeEnabled();

  try {
    // One click only: Playwright retries are disabled to avoid duplicate patients.
    saveAttempted = true;
    const [saveResponse] = await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.origin === UAT_ORIGIN && response.request().method() === 'POST' && /patient|registr/i.test(url.pathname);
      }, { timeout: 30_000 }),
      register.click(),
    ]);
    failureCode = 'SAVE_REJECTED';
    if (!saveResponse.ok()) throw new Error('UAT rejected the synthetic registration; inspect the app separately.');
    failureCode = 'IDENTIFIER_NOT_OBSERVED';

    const responseBody = await saveResponse.json().catch(() => null);
    const returned = extractPatientIdentity(responseBody);
    observedUuid = returned.patientUuid ?? extractPatientUuidFromUrl(saveResponse.headers()['location'] ?? '', UAT_ORIGIN);
    if (!observedUuid) {
      await page.waitForURL((url) => extractPatientUuidFromUrl(url.href, UAT_ORIGIN) !== undefined, { timeout: 10_000 }).catch(() => {});
      observedUuid = extractPatientUuidFromUrl(page.url(), UAT_ORIGIN);
    }

    let actualIdentifier = returned.patientIdentifier;
    if (!actualIdentifier && observedUuid) {
      const lookup = await page.request.get(
        `${UAT_ORIGIN}/openmrs/ws/rest/v1/patient/${observedUuid}?v=full`,
        { timeout: 15_000 },
      );
      if (lookup.ok()) {
        const fullPatient = await lookup.json().catch(() => null);
        const fromUat = extractPatientIdentity(fullPatient);
        actualIdentifier = fromUat.patientIdentifier;
      }
    }
    if (!actualIdentifier) {
      throw new Error('UAT may have created the patient, but its assigned ID was not observed; reconcile before rerunning.');
    }
    confirmedIdentifier = actualIdentifier;
  } catch (error) {
    if (saveAttempted) {
      await recordUatPatientEvent({
        status: 'FAILED',
        fixtureKey,
        module: 'Registration',
        testName: 'Synthetic UAT registration assigned-ID capture',
        sourceKey: '03_Registration!R20',
        patientUuid: observedUuid,
        failureCode,
      });
    }
    throw error;
  }

  // A tracker-write failure is not a registration failure; do not append a false FAILED event.
  if (!confirmedIdentifier) throw new Error('UAT registration identity was not confirmed.');
  await recordUatPatientEvent({
    status: 'CREATED',
    fixtureKey,
    module: 'Registration',
    testName: 'Synthetic UAT registration assigned-ID capture',
    sourceKey: '03_Registration!R20',
    patientIdentifier: confirmedIdentifier,
    patientUuid: observedUuid,
  });
});
