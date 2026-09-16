import { defineConfig, devices } from '@playwright/test';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';

export default defineConfig({
  testDir: './e2e/cases',
  testMatch: 'registration-principal-otp.spec.ts',
  timeout: 5 * 60 * 1000,
  expect: { timeout: 15 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/registration-principal-otp',
  use: {
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
    headless: false,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    storageState: { cookies: [], origins: [] },
  },
  projects: [{
    name: 'uat-principal-otp-chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { executablePath: chromeExecutable },
    },
  }],
});
