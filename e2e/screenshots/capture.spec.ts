import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { closeElectronApp, getMainWindow, launchElectronApp } from '../electron-test-utils.js'
import { COZY_TAVERN_SCENE_ID, seedUserData } from './seed.js'

const VIEWPORT = { width: 1440, height: 900 }
const OUTPUT_DIR = join(process.cwd(), '..', 'docs', 'assets', 'screenshots')

/**
 * The backend loads the repo's `.env` through dotenv, which only fills
 * variables that are missing — so the secrets are pinned to empty strings
 * rather than stripped, otherwise a developer's real token would sneak in.
 */
const SECRET_FREE_ENV = {
  DISCORD_TOKEN: '',
  HIBIKI_VISION_API_KEY: '',
  HIBIKI_VISION_OPENAI_API_KEY: '',
}

let userDataDir: string
let app: ElectronApplication
let page: Page

async function settle(target: Page): Promise<void> {
  await target.waitForLoadState('networkidle').catch(() => {})
  await target.evaluate(() => document.fonts.ready)
  await target.waitForTimeout(400)
}

async function capture(name: string): Promise<void> {
  await settle(page)
  await page.screenshot({
    path: join(OUTPUT_DIR, `${name}.png`),
    clip: { x: 0, y: 0, ...VIEWPORT },
    animations: 'disabled',
  })
}

test.beforeAll(async () => {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  userDataDir = seedUserData()
  app = await launchElectronApp({
    env: {
      ...SECRET_FREE_ENV,
      HIBIKI_USER_DATA_DIR: userDataDir,
      HIBIKI_STORAGE_PATH: join(userDataDir, 'storage'),
      // Hidden windows never paint, so the capture run always shows the window.
      ELECTRON_TEST_MODE: '0',
    },
  })
  page = await getMainWindow(app)
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('hibiki://'))
    win?.setContentSize(size.width, size.height)
  }, VIEWPORT)
  await page.setViewportSize(VIEWPORT)
})

test.afterAll(async () => {
  if (app)
    await closeElectronApp(app)
  if (userDataDir)
    rmSync(userDataDir, { recursive: true, force: true })
})

test('scenes', async () => {
  await page.goto('hibiki://app/scenes')
  await page.locator('.scene-list').waitFor()
  await capture('scenes')
})

test('scene editor', async () => {
  await page.goto(`hibiki://app/scenes/${COZY_TAVERN_SCENE_ID}`)
  await page.getByRole('heading', { name: 'Cozy Tavern' }).waitFor()
  await capture('scene-editor')
})

test('media', async () => {
  await page.goto('hibiki://app/media')
  await page.getByRole('heading', { name: 'Sound library' }).waitFor()
  await page.locator('section.panel').waitFor()
  await capture('media')
})

test('browser', async () => {
  await page.goto('hibiki://app/browser')
  await page.locator('.bookmarks-bar').waitFor()
  await capture('browser')
})

test('settings', async () => {
  await page.goto('hibiki://app/settings')
  await page.getByText('No token yet').waitFor()
  await capture('settings')
})
