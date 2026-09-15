import { defineConfig, devices } from '@playwright/test';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';

export default defineConfig({
  testDir: './e2e/cases',
  testMatch: 'registration-uat.spec.ts',
  timeout: 150 * 1000,
  expect: { timeout: 15 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/registration-uat',
  use: {
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
    ignoreHTTPSErrors: false,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    storageState: { cookies: [], origins: [] },
  },
  projects: [{
    name: 'uat-registration-chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { executablePath: chromeExecutable },
    },
  }],
});
