import { defineConfig } from '@playwright/test'

/**
 * Marketing screenshot capture — a separate Playwright config so `pnpm test`
 * never picks the capture spec up as a regular e2e test.
 */
export default defineConfig({
  testDir: './screenshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  projects: [
    { name: 'electron' },
  ],
})
