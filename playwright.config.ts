import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E Configuration — NxtLegal
 *
 * Runs critical-path tests against the local Next.js dev server.
 * Usage:
 *   npx playwright test                    # headless
 *   npx playwright test --headed           # visible browser
 *   npx playwright test --ui               # interactive UI mode
 *   npx playwright test --project=chromium # single browser
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/.results',

  /* Maximum time a single test can run */
  timeout: 120_000,

  /* Maximum time for expect() assertions */
  expect: {
    timeout: 15_000,
  },

  /* Run tests sequentially — critical path tests are ordered */
  fullyParallel: false,

  /* Fail the build on CI if test.only is left in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry once on CI, never locally (failures should be investigated) */
  retries: process.env.CI ? 1 : 0,

  /* Single worker — tests share state (login → upload → approve) */
  workers: 1,

  /* Reporter configuration */
  reporter: process.env.CI
    ? [['html', { open: 'never', outputFolder: './tests/e2e/.report' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: './tests/e2e/.report' }]],

  /* Shared settings for all projects */
  use: {
    /* Base URL for page.goto('/dashboard') shorthand */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',

    /* Collect trace on first retry for debugging */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on first retry */
    video: 'on-first-retry',

    /* Ignore HTTPS errors for local development */
    ignoreHTTPSErrors: true,

    /* Default navigation timeout */
    navigationTimeout: 30_000,

    /* Default action timeout */
    actionTimeout: 15_000,
  },

  /* Projects — start with Chromium only, expand later */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start the local dev server before running tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
