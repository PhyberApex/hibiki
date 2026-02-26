import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import { config } from 'dotenv'

config({ path: resolve(process.cwd(), '.env.e2e') })
config({ path: resolve(process.cwd(), '../.env.e2e') })

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'on-first-retry',
  },
  // No browser projects - tests use Electron via custom fixture
  projects: [{ name: 'electron' }],
})
