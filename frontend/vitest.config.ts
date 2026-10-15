import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    vue({
      template: {
        transformAssetUrls: {
          // Keep absolute public-dir URLs such as <img src="/logo.svg"> as plain strings under
          // test. The production build (vite.config.ts) still imports them; here Vitest would
          // turn the bare "/logo.svg" id into "file:///logo.svg", which has no drive letter and
          // is rejected on Windows.
          includeAbsolute: false,
        },
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify('99.0.0-test'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/main.ts', 'src/**/icons/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
