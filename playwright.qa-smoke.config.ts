import { defineConfig, devices } from '@playwright/test';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';

export default defineConfig({
  testDir: './e2e/cases',
  testMatch: 'login-smoke.spec.ts',
  timeout: 60 * 1000,
  expect: { timeout: 15 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/qa-smoke', open: 'never' }],
    ['json', { outputFile: 'test-results/qa-smoke-results.json' }],
  ],
  outputDir: 'test-results/qa-smoke',
  use: {
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
    ignoreHTTPSErrors: false,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    storageState: { cookies: [], origins: [] },
  },
  projects: [
    {
      name: 'qa-chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: chromeExecutable },
      },
    },
  ],
});
