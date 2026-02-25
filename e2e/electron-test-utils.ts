import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

// When running from repo root: pnpm run test:e2e, cwd is repo root
// When running from e2e: pnpm --filter e2e run test:playwright, cwd is e2e
const APP_ROOT = process.cwd().endsWith('e2e') ? join(process.cwd(), '..', 'app') : join(process.cwd(), 'app')

/**
 * Launch the Hibiki Electron app for e2e tests.
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

  const app = await electron.launch({
    executablePath,
    args: [mainPath],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      // Use test user data to avoid polluting dev data
      ELECTRON_IS_DEV: '0',
    },
    timeout: 60_000,
  })

  return app
}

/**
 * Get the main window page. Waits for the window to load hibiki://app/
 */
export async function getMainWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow()
  // Wait for app to load (hibiki protocol)
  await window.waitForLoadState('domcontentloaded')
  await window.waitForLoadState('load')
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
    async ({ d, m, a }: { d: string; m: string; a: unknown[] }) => {
      if (!(window as any).hibiki?.invoke)
        throw new Error('Electron API not available')
      return (window as any).hibiki.invoke('api', { domain: d, method: m, args: a }) as Promise<T>
    },
    { d: domain, m: method, a: args },
  )
}
