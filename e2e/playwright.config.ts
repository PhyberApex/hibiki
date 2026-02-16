import { resolve } from 'node:path'
import { config } from 'dotenv'
import { defineConfig, devices } from '@playwright/test'

config({ path: resolve(process.cwd(), '.env.e2e') })
config({ path: resolve(process.cwd(), '../.env.e2e') })

const baseURL = (process.env.E2E_HIBIKI_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  timeout: 60_000,
  expect: { timeout: 10_000 },
})
