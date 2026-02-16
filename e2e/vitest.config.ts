import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
    setupFiles: ['./setup.ts'],
    env: process.env.CI ? {} : undefined,
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**'],
  },
  resolve: {
    alias: {
      '@e2e': resolve(__dirname, './'),
    },
  },
})
