import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'

// When running from repo root: pnpm run test:e2e, cwd is repo root
// When running from e2e: pnpm --filter e2e run test:playwright, cwd is e2e
// After project flattening, all code is at repo root (no app/ subdirectory)
const APP_ROOT = process.cwd().endsWith('e2e') ? join(process.cwd(), '..') : process.cwd()

/**
 * Launch the Hibiki Electron app for e2e tests.
 *
 * By default, launches in headless mode (no visible windows) for CI/CD.
 * To watch tests run in headed mode, set: HIBIKI_E2E_HEADED=1
 *
 * Example: HIBIKI_E2E_HEADED=1 pnpm test:e2e
 */
export async function launchElectronApp(): Promise<ElectronApplication> {
  const mainPath = join(APP_ROOT, 'electron', 'main.js')

  // Resolve Electron executable - pnpm may store it in node_modules/.pnpm
  const electronPkg = join(APP_ROOT, 'node_modules', 'electron')
  const electronBin = process.platform === 'darwin'
    ? join(electronPkg, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : process.platform === 'win32'
      ? join(electronPkg, 'dist', 'electron.exe')
      : join(electronPkg, 'dist', 'electron')
  const executablePath = electronBin

  // Check if user wants to watch tests run (headed mode)
  const headed = process.env.HIBIKI_E2E_HEADED === '1'

  // CI runners (GitHub Actions) can't use the SUID sandbox — chrome-sandbox
  // must be root-owned with mode 4755, which isn't possible in containers.
  const isCI = !!process.env.CI
  const args = isCI ? ['--no-sandbox', mainPath] : [mainPath]

  const app = await electron.launch({
    executablePath,
    args,
    cwd: APP_ROOT,
    env: {
      ...process.env,
      // Use test user data to avoid polluting dev data
      ELECTRON_IS_DEV: '0',
      // Headless by default (ELECTRON_TEST_MODE=1), headed if HIBIKI_E2E_HEADED=1
      ELECTRON_TEST_MODE: headed ? '0' : '1',
    },
    timeout: 60_000,
  })

  return app
}

/**
 * Get the main window page. Waits for the window to load hibiki://app/
 *
 * In headed mode (HIBIKI_E2E_HEADED=1), the app shows a splash screen first.
 * firstWindow() may return the splash window which gets closed when the main
 * window is ready. We detect this by checking the URL and waiting for the
 * main window (hibiki://app/) to appear.
 */
export async function getMainWindow(app: ElectronApplication): Promise<Page> {
  let window = await app.firstWindow()

  // In headed mode, the first window may be the splash screen (file:// URL).
  // Wait for the main window (hibiki://app/) to appear instead.
  if (!window.url().startsWith('hibiki://')) {
    // The splash will be closed when the main window is ready.
    // Wait for a new window with the hibiki:// protocol.
    window = await new Promise<Page>((resolve) => {
      const check = (page: Page) => {
        if (page.url().startsWith('hibiki://')) {
          app.off('window', check)
          resolve(page)
        }
      }
      // Check existing windows first
      for (const w of app.windows()) {
        if (w.url().startsWith('hibiki://')) {
          resolve(w)
          return
        }
      }
      app.on('window', check)
    })
  }

  // Wait for the Vue app to mount and render content
  await window.locator('#app').waitFor({ state: 'attached', timeout: 30000 })
  await window.locator('#app h1, #app button, #app nav').first().waitFor({ timeout: 30000 })

  return window
}

/**
 * Call the Electron IPC API from a test. Must be run in page context.
 * Use page.evaluate with this stringified and passed, or use invokeApi below.
 */
export async function invokeApi<T>(
  page: Page,
  domain: string,
  method: string,
  args: unknown[] = [],
): Promise<T> {
  return page.evaluate(
    async ({ d, m, a }: { d: string, m: string, a: unknown[] }) => {
      if (!(window as any).hibiki?.invoke)
        throw new Error('Electron API not available')
      return (window as any).hibiki.invoke('api', { domain: d, method: m, args: a }) as Promise<T>
    },
    { d: domain, m: method, a: args },
  )
}
