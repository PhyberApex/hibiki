import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, launchElectronApp } from '../electron-test-utils.js'

/**
 * The layers that contain a renderer compromise (#774): the CSP on
 * `hibiki://app`, the preload's channel allowlist, and the self-hosted
 * typeface the CSP depends on. Needs no Discord token.
 */

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
  userDataDir = mkdtempSync(join(tmpdir(), 'hibiki-e2e-hardening-'))
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
})

test.afterAll(async () => {
  if (app)
    await closeElectronApp(app)
  if (userDataDir)
    rmSync(userDataDir, { recursive: true, force: true })
})

test('hibiki://app pages carry a Content-Security-Policy', async () => {
  const csp = await page.evaluate(async () => (await fetch('/')).headers.get('content-security-policy'))
  expect(csp).toContain('default-src \'none\'')
  expect(csp).toContain('script-src \'self\' blob:')
})

test('an injected inline script does not run', async () => {
  const ran = await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.__injected = true'
    document.head.append(script)
    return (window as any).__injected === true
  })
  expect(ran).toBe(false)
})

test('the self-hosted typeface loads under the CSP', async () => {
  const loaded = await page.evaluate(async () => (await document.fonts.load('600 16px "Plus Jakarta Sans"')).length)
  expect(loaded).toBeGreaterThan(0)
})

test('the preload refuses a channel off its allowlist and still carries the api channel', async () => {
  const refused = await page.evaluate(() => (window as any).hibiki.invoke('not:aChannel').then(() => null, (err: Error) => err.message))
  expect(refused).toContain('Unknown IPC channel: not:aChannel')

  const status = await page.evaluate(() => (window as any).hibiki.invoke('hotkeys:getStatus'))
  expect(status).toBeTruthy()

  await expect.poll(logText).toContain('[preload] Refused invoke on unknown channel not:aChannel')
})
