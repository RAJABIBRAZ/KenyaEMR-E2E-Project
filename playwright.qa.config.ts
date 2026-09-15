import { defineConfig, devices } from '@playwright/test';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';

export default defineConfig({
  testDir: './e2e/performance',
  testMatch: 'qa-performance.spec.ts',
  timeout: 4 * 60 * 1000,
  expect: {
    timeout: 30 * 1000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/qa-performance', open: 'never' }]],
  outputDir: 'test-results/qa-performance',
  use: {
    actionTimeout: 30 * 1000,
    navigationTimeout: 60 * 1000,
    ignoreHTTPSErrors: false,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'qa-chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: chromeExecutable,
        },
      },
    },
  ],
});
