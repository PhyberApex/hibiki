import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, launchElectronApp } from '../electron-test-utils.js'

/**
 * The main window carries the preload, so it must never open a child window
 * or navigate away from the app (#638). External links go to the system
 * browser instead, stubbed here from the main process. Needs no Discord token.
 */

const REPO_URL = 'https://github.com/PhyberApex/hibiki'

let userDataDir: string
let app: ElectronApplication
let page: Page

function logText(): string {
  try {
    return readFileSync(join(userDataDir, 'logs', 'hibiki.log'), 'utf8')
  }
  catch {
    return ''
  }
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'hibiki-e2e-nav-'))
  mkdirSync(join(userDataDir, 'data'), { recursive: true })
  writeFileSync(join(userDataDir, 'data', 'app-config.json'), JSON.stringify({}))
  app = await launchElectronApp({
    env: {
      DISCORD_TOKEN: '',
      HIBIKI_USER_DATA_DIR: userDataDir,
      HIBIKI_STORAGE_PATH: join(userDataDir, 'storage'),
    },
  })
  page = await getMainWindow(app)
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as any).__openedExternally = opened
    shell.openExternal = (async (url: string) => {
      opened.push(url)
    }) as typeof shell.openExternal
  })
})

test.afterAll(async () => {
  if (app)
    await closeElectronApp(app)
  if (userDataDir)
    rmSync(userDataDir, { recursive: true, force: true })
})

test('the About GitHub link opens the system browser, not a second window', async () => {
  // A fresh profile opens on the Welcome screen, which has no footer.
  await page.goto('hibiki://app/scenes')
  await page.getByRole('link', { name: 'About', exact: true }).click()
  await page.getByRole('link', { name: 'GitHub', exact: true }).click()

  await expect.poll(() => app.evaluate(() => (globalThis as any).__openedExternally as string[])).toEqual([REPO_URL])
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  expect(app.windows()).toHaveLength(1)
})

test('the main window refuses to navigate away from the app', async () => {
  await page.evaluate(() => {
    window.location.href = 'https://example.com/elsewhere?token=secret'
  })

  await expect.poll(logText).toContain('Blocked navigation of the main window to https://example.com')
  expect(page.url()).toMatch(/^hibiki:\/\/app\//)
  expect(logText()).not.toContain('token=secret')
})
