import type { ElectronApplication, Page } from '@playwright/test'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, launchElectronApp } from '../electron-test-utils.js'

/**
 * A reloaded or crashed main renderer cannot close the Browser tabs the old
 * one opened (#653): main closes them itself. Needs no Discord token.
 */

let userDataDir: string
let app: ElectronApplication
let page: Page
let server: Server
let pageUrl: string

function logText(): string {
  try {
    return readFileSync(join(userDataDir, 'logs', 'hibiki.log'), 'utf8')
  }
  catch {
    return ''
  }
}

/** How many Browser tab views are attached to the main window. */
function attachedViews(): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.length ?? -1)
}

/** The ids (their `webContents` ids) of the Browser tab views attached to the main window. */
function attachedTabIds(): Promise<number[]> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) =>
    (BrowserWindow.getAllWindows()[0]?.contentView.children ?? [])
      .filter(view => view instanceof WebContentsView)
      .map(view => (view as InstanceType<typeof WebContentsView>).webContents.id))
}

async function openTab(): Promise<void> {
  await page.goto('hibiki://app/browser')
  const urlInput = page.getByPlaceholder('Paste or type a URL…')
  await urlInput.waitFor()
  await urlInput.fill(pageUrl)
  await urlInput.press('Enter')
  await expect.poll(attachedViews).toBe(1)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  server = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Teardown fixture</title><body><h1>tab</h1></body>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  pageUrl = `http://127.0.0.1:${typeof address === 'object' && address
    ? address.port
    : 0}/`

  userDataDir = mkdtempSync(join(tmpdir(), 'hibiki-e2e-teardown-'))
  mkdirSync(join(userDataDir, 'data'), { recursive: true })
  writeFileSync(join(userDataDir, 'data', 'app-config.json'), JSON.stringify({}))
  app = await launchElectronApp({
    env: {
      DISCORD_TOKEN: '',
      HIBIKI_VISION_API_KEY: '',
      HIBIKI_VISION_OPENAI_API_KEY: '',
      HIBIKI_USER_DATA_DIR: userDataDir,
      HIBIKI_STORAGE_PATH: join(userDataDir, 'storage'),
    },
  })
  page = await getMainWindow(app)
})

test.afterAll(async () => {
  if (app)
    await closeElectronApp(app)
  await new Promise<void>(resolve => server?.close(() => resolve()))
  if (userDataDir)
    rmSync(userDataDir, { recursive: true, force: true })
})

test('a reload of the main window closes the Browser tabs the old renderer opened', async () => {
  await openTab()
  const [oldTabId] = await attachedTabIds()
  expect(oldTabId).toBeDefined()

  await page.reload()
  await page.locator('#app nav').first().waitFor()

  // The reloaded renderer is still on the Browser view, which opens its default tab again: only the old tab must go.
  await expect.poll(attachedTabIds).not.toContain(oldTabId)
  await expect.poll(logText).toContain(`Tab ${oldTabId} closed: renderer navigated`)
})

test('a crashed main renderer leaves no Browser tab behind', async () => {
  await openTab()

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())

  await expect.poll(attachedViews).toBe(0)
  await expect.poll(logText).toMatch(/Renderer process gone/)
  await expect.poll(logText).toMatch(/Tab \d+ closed: renderer gone/)
})
