import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'

const appPkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf-8'),
) as { version?: string }
const appVersion = typeof appPkg.version === 'string' ? appPkg.version : '0.0.0'

export default defineConfig(({ mode }) => ({
  build: {
    outDir: join(dirname(fileURLToPath(import.meta.url)), '../web-dist'),
    emptyOutDir: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    vue(),
    ...(mode === 'development' ? [vueDevTools()] : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
}))
