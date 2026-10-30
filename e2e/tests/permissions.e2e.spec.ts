import type { ElectronApplication, Page } from '@playwright/test'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, launchElectronApp } from '../electron-test-utils.js'

/**
 * Browser tabs share the renderer's session, so a page opened in one must not
 * inherit the app's permissions (#706). The fixture asks for the microphone on
 * load and keeps the outcome for the test to read. Needs no Discord token.
 * CI runners have no microphone, and Chromium rejects with `NotFoundError`
 * before asking the permission handler, so the app gets fake capture devices.
 */

const PAGE = `<!doctype html><title>Permission fixture</title><body><script>
  window.__micResult = 'pending'
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(() => { window.__micResult = 'granted' })
    .catch((err) => { window.__micResult = err.name })
</script></body>`

let userDataDir: string
let app: ElectronApplication
let page: Page
let server: Server
let pageUrl: string
let pageOrigin: string

function logText(): string {
  try {
    return readFileSync(join(userDataDir, 'logs', 'hibiki.log'), 'utf8')
  }
  catch {
    return ''
  }
}

/** `window.__micResult` of the Browser tab showing `pageUrl`, or `null` while it has not loaded. */
function micResult(): Promise<string | null> {
  return app.evaluate(async ({ webContents }, url) => {
    const tab = webContents.getAllWebContents().find(wc => wc.getURL() === url)
    return tab
      ? tab.executeJavaScript('window.__micResult ?? null')
      : null
  }, pageUrl)
}

test.beforeAll(async () => {
  server = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  pageOrigin = `http://127.0.0.1:${typeof address === 'object' && address
    ? address.port
    : 0}`
  pageUrl = `${pageOrigin}/`

  userDataDir = mkdtempSync(join(tmpdir(), 'hibiki-e2e-permissions-'))
  mkdirSync(join(userDataDir, 'data'), { recursive: true })
  writeFileSync(join(userDataDir, 'data', 'app-config.json'), JSON.stringify({}))
  app = await launchElectronApp({
    args: ['--use-fake-device-for-media-stream'],
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

test('a Browser tab page asking for the microphone is denied and the refusal is logged', async () => {
  await page.goto('hibiki://app/browser')
  const urlInput = page.getByPlaceholder('Paste or type a URL…')
  await urlInput.waitFor()
  await urlInput.fill(pageUrl)
  await urlInput.press('Enter')

  await expect.poll(micResult, { timeout: 15_000 }).toBe('NotAllowedError')
  await expect.poll(logText).toContain(`[permissions] Denied media to ${pageOrigin}`)
})
