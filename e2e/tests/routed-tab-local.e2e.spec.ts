import type { ElectronApplication, Page } from '@playwright/test'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, launchElectronApp } from '../electron-test-utils.js'

/**
 * Routes a Browser tab to the Local Target (ADR-0007): the real tab capture,
 * the mute IPC and the gain path run end to end, observed through hibiki.log.
 * Needs no Discord token.
 */

// The page keeps a live audio graph so the tab capture has a source, at gain 0:
// the assertions read hibiki.log, nothing needs to be audible on the test machine.
const PAGE = `<!doctype html><title>Routed Tab fixture</title><body><h1>silent tone</h1><script>
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  osc.frequency.value = 440
  const gain = ctx.createGain()
  gain.gain.value = 0
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start()
  ctx.resume()
</script></body>`

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

test.beforeAll(async () => {
  server = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  pageUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`

  userDataDir = mkdtempSync(join(tmpdir(), 'hibiki-e2e-routed-tab-'))
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

test('routes a tab to the Local Target, follows the Tab Volume and un-routes', async () => {
  await page.getByRole('button', { name: /Play at the table/ }).click()
  await page.goto('hibiki://app/browser')
  const urlInput = page.getByPlaceholder('Paste or type a URL…')
  await urlInput.waitFor()
  await urlInput.fill(pageUrl)
  await urlInput.press('Enter')
  await expect.poll(logText).toContain(`Tab `)

  const toggle = page.getByRole('button', { name: /Mix locally/ })
  await expect(toggle).toBeEnabled()
  await toggle.click()

  await expect.poll(logText, { timeout: 15_000 }).toMatch(/\[browser\] tab \d+ routed to local at level 80/)
  await expect.poll(logText).toMatch(/Tab \d+ muted/)
  await expect(page.getByRole('button', { name: /Stop/ })).toBeVisible()

  const slider = page.getByRole('slider', { name: 'Tab Volume' })
  await slider.fill('50')
  await expect.poll(logText).toMatch(/\[browser\] tab \d+ level 40 \(tab 50 × master 80\) on local/)

  await page.getByRole('button', { name: /Stop/ }).click()
  await expect.poll(logText).toMatch(/\[browser\] tab \d+ stops on local/)
  await expect.poll(logText).toMatch(/Tab \d+ unmuted/)
  await expect(page.getByRole('button', { name: /Mix locally/ })).toBeVisible()
})
