import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, invokeApi, launchElectronApp } from '../electron-test-utils.js'
import { writeMinimalWav } from '../fixtures/minimal-wav.js'

/**
 * Drives a Scene's whole lifecycle through the Scene editor and playback bar on
 * the Local Target: create, edit, play, toggle, trigger, master volume, stop and
 * delete. Needs no Discord token, so it runs on every PR; the IPC API is only
 * read back to check what the UI did.
 */

const LOCAL = 'local'
const SCENE_NAME = 'Tavern Night'
// The library names a file by humanizing its id: `tavern-theme.wav` lists as "Tavern Theme".
const MUSIC = { id: 'tavern-theme', name: 'Tavern Theme' }
const AMBIENCE = { id: 'forest-rain', name: 'Forest Rain' }
const EFFECT = { id: 'door-slam', name: 'Door Slam' }
const EFFECT_SECONDS = 1.5

interface PlaybackState {
  targetId: string
  track: { id: string } | null
  ambience?: string[]
  effects?: { instanceId: string, soundId: string }[]
}

let userDataDir: string
let app: ElectronApplication
let page: Page

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), 'hibiki-e2e-scene-ui-'))
  mkdirSync(join(root, 'data'), { recursive: true })
  const files: [string, string, number][] = [['music', MUSIC.id, 10], ['ambience', AMBIENCE.id, 10], ['effects', EFFECT.id, EFFECT_SECONDS]]
  for (const [category, id, seconds] of files) {
    mkdirSync(join(root, 'storage', category), { recursive: true })
    writeMinimalWav(join(root, 'storage', category, `${id}.wav`), seconds)
  }
  writeFileSync(join(root, 'data', 'app-config.json'), JSON.stringify({}))
  return root
}

async function localState(): Promise<PlaybackState | undefined> {
  const states = await invokeApi<PlaybackState[]>(page, 'player', 'getState')
  return states.find(s => s.targetId === LOCAL)
}

function listScenes() {
  return invokeApi<{ name: string, music: any[], ambience: any[], effects: any[] }[]>(page, 'scenes', 'list')
}

/** Range inputs cannot be filled; set the value and fire what a drag fires (`input` while moving, `change` on release). */
async function setRange(slider: Locator, value: number) {
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement
    input.value = String(v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
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

test('creates, plays, edits live, stops and deletes a Scene through the UI on the Local Target', async () => {
  await page.getByRole('button', { name: /Play at the table/ }).click()
  await expect(page.getByRole('heading', { name: 'Scenes', exact: true })).toBeVisible()
  expect(await invokeApi(page, 'config', 'getActiveOutputTarget')).toBe(LOCAL)

  // 1. Create and edit the Scene; every edit saves on its own.
  await page.getByRole('button', { name: 'New scene' }).click()
  await page.getByLabel('Scene name').fill(SCENE_NAME)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('heading', { name: SCENE_NAME, exact: true })).toBeVisible()

  await page.getByLabel('Add music').selectOption({ label: MUSIC.name })
  await expect(page.getByLabel(`Loop ${MUSIC.name}`)).toBeChecked()
  await setRange(page.getByLabel(`Volume for ${MUSIC.name}`), 60)

  await page.getByLabel('Add ambience').selectOption({ label: AMBIENCE.name })
  await expect(page.getByLabel(`Enable ${AMBIENCE.name}`)).toBeChecked()
  // 0-0 is the default, so move off it first: the save proves the selects are wired.
  await page.getByLabel(`Shortest repeat interval for ${AMBIENCE.name}`).selectOption('5')
  await expect.poll(async () => (await listScenes())[0]?.ambience[0]).toMatchObject({ repeatMin: 5, repeatMax: 5 })
  await page.getByLabel(`Shortest repeat interval for ${AMBIENCE.name}`).selectOption('0')
  await page.getByLabel(`Longest repeat interval for ${AMBIENCE.name}`).selectOption('0')
  await setRange(page.getByLabel(`Volume for ${AMBIENCE.name}`), 40)

  await page.getByLabel('Add effect').selectOption({ label: EFFECT.name })
  await expect(page.getByRole('button', { name: EFFECT.name, exact: true })).toBeVisible()

  await expect.poll(listScenes).toMatchObject([{
    name: SCENE_NAME,
    music: [{ soundId: MUSIC.id, volume: 60, loop: true }],
    ambience: [{ soundId: AMBIENCE.id, volume: 40, enabled: true, repeatMin: 0, repeatMax: 0 }],
    // The editor has no per-Effect volume control; a new item starts at 80.
    effects: [{ soundId: EFFECT.id, volume: 80 }],
  }])

  // 2. Play from the playback bar.
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => (await localState())?.track?.id, { timeout: 5_000 }).toBe(MUSIC.id)
  await expect.poll(async () => (await localState())?.ambience ?? [], { timeout: 5_000 }).toContain(AMBIENCE.id)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await expect(page.getByText(`${MUSIC.name} · 1 ambience`)).toBeVisible()
  // The Scene list badges the Playing Scene; going there and back does not stop it.
  await page.getByRole('link', { name: 'Scenes', exact: true }).click()
  await expect(page.getByRole('link', { name: new RegExp(SCENE_NAME) }).getByLabel('Playing locally')).toBeVisible()
  await page.getByRole('link', { name: new RegExp(SCENE_NAME) }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  expect((await localState())?.track?.id).toBe(MUSIC.id)

  // 3. Ambience follows its card's toggle.
  await page.getByLabel(`Enable ${AMBIENCE.name}`).uncheck()
  await expect.poll(async () => (await localState())?.ambience ?? []).not.toContain(AMBIENCE.id)
  await page.getByLabel(`Enable ${AMBIENCE.name}`).check()
  await expect.poll(async () => (await localState())?.ambience ?? []).toContain(AMBIENCE.id)

  // 4. The Effect plays once and ends with its file; Music and Ambience keep going.
  await page.getByRole('button', { name: EFFECT.name, exact: true }).click()
  await expect.poll(async () => (await localState())?.effects?.map(e => e.soundId) ?? []).toContain(EFFECT.id)
  await expect.poll(async () => (await localState())?.effects ?? [], { timeout: 20_000 }).toHaveLength(0)
  const afterEffect = await localState()
  expect(afterEffect?.track?.id).toBe(MUSIC.id)
  expect(afterEffect?.ambience).toContain(AMBIENCE.id)

  // 5. The master volume persists per Target.
  await setRange(page.getByLabel('Global volume'), 55)
  await expect.poll(() => invokeApi<number>(page, 'config', 'getMasterVolume', [LOCAL])).toBe(55)

  // 6. Stop clears playback; Delete asks first, then removes the Scene.
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect.poll(async () => {
    const state = await localState()
    return { track: state?.track ?? null, ambience: state?.ambience ?? [], effects: state?.effects ?? [] }
  }).toEqual({ track: null, ambience: [], effects: [] })
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()

  let confirmMessage = ''
  page.once('dialog', (dialog) => {
    confirmMessage = dialog.message()
    void dialog.accept()
  })
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Get started with scenes' })).toBeVisible()
  expect(confirmMessage).toContain(SCENE_NAME)
  expect(await listScenes()).toEqual([])

  // 7. Nothing went wrong on the way: sink health and renderer errors are only logged.
  await expect.poll(logText).toContain('Local sink started in the renderer')
  const log = logText()
  expect(log).not.toMatch(/Local sink (failed|deviceLost)/)
  expect(log).not.toContain('Local sink AudioContext suspended')
  expect(log).not.toMatch(/\[error\]\s+\[renderer\]\s+\[scenes?\]/)
})
