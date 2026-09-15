import { defineConfig, devices } from '@playwright/test';

const chromeExecutable = process.env.QA_CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';

export default defineConfig({
  testDir: './e2e/performance',
  testMatch: 'qa-performance.spec.ts',
  timeout: 5 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/uat-performance-10-cycle', open: 'never' }],
    ['json', { outputFile: 'test-results/uat-performance-10-cycle-summary.json' }],
  ],
  outputDir: 'test-results/uat-performance-10-cycle',
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
      name: 'uat-chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: chromeExecutable },
      },
    },
  ],
});
