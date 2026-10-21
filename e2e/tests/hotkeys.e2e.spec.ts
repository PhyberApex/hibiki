import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, invokeApi, launchElectronApp } from '../electron-test-utils.js'
import { writeMinimalWav } from '../fixtures/minimal-wav.js'

/**
 * Global Hotkeys (ADR-0005) from registration to playback on the Local Target.
 * Playwright cannot press an OS-level shortcut, so the test stands in for the
 * OS: it sends `hotkey:fired` from the main process, exactly what
 * `electron/hotkeys.js` sends when a registered key goes down. Needs no
 * Discord token.
 */

const LOCAL = 'local'
const SCENE_ID = 'e2e-hotkeys-scene'
const MUSIC_ID = 'e2e-hotkeys-music'
const EFFECT_ID = 'e2e-hotkeys-effect'
const EFFECT_SECONDS = 3

interface PlaybackState {
  targetId: string
  track: { id: string } | null
  effects?: { instanceId: string, soundId: string }[]
}

interface HotkeyStatus {
  enabled: boolean
  registered: string[]
  failures: { accelerator: string, owner: string, reason: string }[]
}

let userDataDir: string
let app: ElectronApplication
let page: Page

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), 'hibiki-e2e-hotkeys-'))
  const dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })
  const files: [string, string, number][] = [['music', MUSIC_ID, 10], ['effects', EFFECT_ID, EFFECT_SECONDS]]
  for (const [category, id, seconds] of files) {
    mkdirSync(join(root, 'storage', category), { recursive: true })
    writeMinimalWav(join(root, 'storage', category, `${id}.wav`), seconds)
  }
  const item = (soundId: string, extra = {}) => ({ soundId, soundName: soundId, volume: 50, ...extra })
  const scene = {
    id: SCENE_ID,
    name: 'E2E Hotkeys Scene',
    hotkey: 'F13',
    music: [item(MUSIC_ID, { loop: true })],
    ambience: [],
    effects: [item(EFFECT_ID, { hotkey: 'F14' })],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  writeFileSync(join(dataDir, 'scenes.json'), JSON.stringify([scene]))
  // app-config.json holds string values; the hotkey settings are stored as JSON.
  writeFileSync(join(dataDir, 'app-config.json'), JSON.stringify({ hotkeys: JSON.stringify({ enabled: true }) }))
  return root
}

async function localState(): Promise<PlaybackState | undefined> {
  const states = await invokeApi<PlaybackState[]>(page, 'player', 'getState')
  return states.find(s => s.targetId === LOCAL)
}

function hotkeyStatus(): Promise<HotkeyStatus> {
  return page.evaluate(() => (window as any).hibiki.invoke('hotkeys:getStatus') as Promise<HotkeyStatus>)
}

/** Every accelerator Hibiki asked the OS for, whether the OS granted it or refused it. */
async function heldKeys(): Promise<string[]> {
  const { registered, failures } = await hotkeyStatus()
  return [...new Set([...registered, ...failures.map(f => f.accelerator)])].sort()
}

/** What `electron/hotkeys.js` sends to the main window when the OS reports `accelerator`. */
async function fire(accelerator: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, key) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('hibiki://'))
    if (!win)
      throw new Error('No main window to send hotkey:fired to')
    win.webContents.send('hotkey:fired', { accelerator: key })
  }, accelerator)
}

/**
 * A key press as the user makes it: the OS only delivers a key Hibiki holds. Where the OS refuses
 * every key (Wayland, some headless X servers) the test stands in for it for each key Hibiki asked for.
 * Resolves to whether the press reached the app.
 */
async function press(accelerator: string): Promise<boolean> {
  if (!(await heldKeys()).includes(accelerator))
    return false
  await fire(accelerator)
  return true
}

function logText(): string {
  try {
    return readFileSync(join(userDataDir, 'logs', 'hibiki.log'), 'utf8')
  }
  catch {
    return ''
  }
}

test.beforeAll(async () => {
  userDataDir = seed()
  app = await launchElectronApp({
    // Pinned to empty rather than stripped: the backend's dotenv only fills missing variables.
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
  if (userDataDir)
    rmSync(userDataDir, { recursive: true, force: true })
})

test('Scene and Effect Hotkeys register, fire on the Local Target, follow a rebind and stop when disabled', async () => {
  await page.getByRole('button', { name: /Play at the table/ }).click()
  await expect(page.getByRole('heading', { name: 'Scenes', exact: true })).toBeVisible()
  expect(await invokeApi(page, 'config', 'getActiveOutputTarget')).toBe(LOCAL)

  // 1. Both seeded keys are registered, or refused with a reason that Settings → Diagnostics shows.
  const status = await hotkeyStatus()
  expect(status.enabled).toBe(true)
  expect(await heldKeys()).toEqual(['F13', 'F14'])
  for (const failure of status.failures)
    expect(failure.reason).not.toBe('')
  if (status.failures.length > 0) {
    await page.goto('hibiki://app/settings')
    const diagnostics = page.getByTestId('hotkey-failures')
    for (const failure of status.failures)
      await expect(diagnostics).toContainText(`${failure.accelerator} (${failure.owner}): ${failure.reason}`)
    await page.goto('hibiki://app/scenes')
  }

  // 2. The Scene Hotkey starts the Scene.
  expect(await press('F13')).toBe(true)
  await expect.poll(async () => (await localState())?.track?.id, { timeout: 5_000 }).toBe(MUSIC_ID)

  // 3. The Effect Hotkey plays its Effect while the Scene plays...
  expect(await press('F14')).toBe(true)
  await expect.poll(async () => (await localState())?.effects?.map(e => e.soundId) ?? [], { timeout: 5_000 }).toContain(EFFECT_ID)

  // ...and does nothing once no Scene is playing, saying why in the log.
  expect(await press('F13')).toBe(true)
  await expect.poll(async () => (await localState())?.track ?? null, { timeout: 10_000 }).toBeNull()
  await expect.poll(async () => (await localState())?.effects ?? [], { timeout: 10_000 }).toHaveLength(0)
  expect(await press('F14')).toBe(true)
  await expect.poll(logText).toContain('[hotkeys] F14 ignored: no Scene or Stop binding, and no Effect in the Playing Scene (none)')
  expect((await localState())?.effects ?? []).toHaveLength(0)

  // 4. Rebinding the Scene Hotkey in the editor moves the registration with it.
  await page.goto(`hibiki://app/scenes/${SCENE_ID}`)
  const recorder = page.getByRole('button', { name: /^Scene Hotkey: F13\./ })
  await recorder.click()
  // Playwright's keyboard has no key beyond F12, so the keydown is dispatched with the physical code.
  await recorder.dispatchEvent('keydown', { code: 'F15', key: 'F15' })
  await expect(page.getByRole('button', { name: /^Scene Hotkey: F15\./ })).toBeVisible()
  await expect.poll(heldKeys).toEqual(['F14', 'F15'])

  // Even delivered straight to the app, F13 is bound to nothing any more.
  await fire('F13')
  await expect.poll(logText).toContain('[hotkeys] F13 ignored: no Scene or Stop binding')
  expect((await localState())?.track ?? null).toBeNull()

  expect(await press('F15')).toBe(true)
  await expect.poll(async () => (await localState())?.track?.id, { timeout: 5_000 }).toBe(MUSIC_ID)
  expect(await press('F15')).toBe(true)
  await expect.poll(async () => (await localState())?.track ?? null, { timeout: 10_000 }).toBeNull()

  // 5. Turning hotkeys off in Settings hands every key back: nothing is held and F15 does nothing.
  await page.goto('hibiki://app/settings')
  const toggle = page.getByLabel('Enable global hotkeys')
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await expect.poll(hotkeyStatus).toEqual({ enabled: false, registered: [], failures: [] })
  expect(await app.evaluate(({ globalShortcut }) => ['F13', 'F14', 'F15'].some(key => globalShortcut.isRegistered(key)))).toBe(false)
  expect(await press('F15')).toBe(false)
  expect((await localState())?.track ?? null).toBeNull()
})
