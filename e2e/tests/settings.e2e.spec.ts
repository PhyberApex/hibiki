import type { ElectronApplication, Locator, Page } from '@playwright/test'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, invokeApi, launchElectronApp } from '../electron-test-utils.js'
import { writeMinimalWav } from '../fixtures/minimal-wav.js'

/**
 * Settings that only prove themselves across a restart or against a provider:
 * the per-Target master volume and the active Target survive relaunching the
 * same profile, and Vision to Vibe runs end to end against a fake
 * OpenAI-compatible server in this process. Needs no Discord token or network.
 */

const LOCAL = 'local'
const DISCORD = 'discord'
const SCENE_ID = '5f0c2a9e-7d4b-4e1a-8c3f-2b6d9e0a1c47'
const SCENE_NAME = 'Rainy Tavern'
// The library names a file by humanizing its id: `tavern-theme.wav` lists as "Tavern Theme".
const SOUNDS = {
  music: [
    { id: 'tavern-theme', name: 'Tavern Theme', tags: ['tavern', 'cozy'] },
    { id: 'battle-drums', name: 'Battle Drums', tags: ['battle', 'epic'] },
  ],
  ambience: [
    { id: 'stormy-rain', name: 'Stormy Rain', tags: ['rain', 'night'] },
    { id: 'forest-birds', name: 'Forest Birds', tags: ['forest', 'day'] },
  ],
} as const
const VIBE = { description: 'A candlelit tavern while rain hammers the shutters.', tags: ['tavern', 'rain'] }

/** A 1x1 PNG: big enough to be a distinctive base64 string in a request body or log. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

interface FakeRequest {
  url: string
  authorization: string | undefined
  body: string
}

let userDataDir: string
let imagePath: string
let app: ElectronApplication | undefined
let page: Page
const providerRequests: FakeRequest[] = []
const provider = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    providerRequests.push({ url: req.url ?? '', authorization: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8') })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(VIBE) } }] }))
  })
})

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), 'hibiki-e2e-settings-'))
  mkdirSync(join(root, 'data'), { recursive: true })
  const tags: Record<string, readonly string[]> = {}
  for (const [category, sounds] of Object.entries(SOUNDS)) {
    mkdirSync(join(root, 'storage', category), { recursive: true })
    for (const sound of sounds) {
      writeMinimalWav(join(root, 'storage', category, `${sound.id}.wav`))
      tags[`${category}/${sound.id}`] = sound.tags
    }
  }
  const now = new Date().toISOString()
  writeFileSync(join(root, 'data', 'scenes.json'), JSON.stringify([
    { id: SCENE_ID, name: SCENE_NAME, music: [], ambience: [], effects: [], createdAt: now, updatedAt: now },
  ]))
  writeFileSync(join(root, 'data', 'sound-tags.json'), JSON.stringify(tags))
  // The launch update check would GET GitHub on every (re)launch; keep the run off the network.
  writeFileSync(join(root, 'data', 'app-config.json'), JSON.stringify({ updates: JSON.stringify({ enabled: false }) }))
  imagePath = join(root, 'battle-map.png')
  writeFileSync(imagePath, PNG)
  return root
}

/** (Re)launches the app against the same profile; a restart is a close followed by this. */
async function launch(): Promise<void> {
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
}

async function restart(): Promise<void> {
  if (app)
    await closeElectronApp(app)
  app = undefined
  await launch()
}

async function openScene(): Promise<void> {
  await page.goto(`hibiki://app/scenes/${SCENE_ID}`)
  await expect(page.getByRole('heading', { name: SCENE_NAME, exact: true })).toBeVisible()
}

function targetButton(name: 'Discord' | 'Local'): Locator {
  return page.getByRole('group', { name: 'Output Target' }).getByRole('button', { name, exact: true })
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

// Each test builds on the settings the previous one left behind; serial mode makes a retry rerun all of them (a retry is a new worker, so beforeAll seeds a fresh profile).
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  userDataDir = seed()
  await launch()
})

test.afterAll(async () => {
  if (app)
    await closeElectronApp(app)
  await new Promise<void>(resolve => provider.close(() => resolve()))
  if (userDataDir)
    rmSync(userDataDir, { recursive: true, force: true })
})

test('the master volume of each Output Target and the active Target survive a restart', async () => {
  await openScene()
  const volume = page.getByLabel('Global volume')
  // No Discord token: the Local Target is the default.
  await expect(targetButton('Local')).toHaveAttribute('aria-pressed', 'true')

  await setRange(volume, 35)
  await expect.poll(() => invokeApi<number>(page, 'config', 'getMasterVolume', [LOCAL])).toBe(35)

  await targetButton('Discord').click()
  await expect(targetButton('Discord')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => invokeApi(page, 'config', 'getActiveOutputTarget')).toBe(DISCORD)
  await setRange(volume, 70)
  await expect.poll(() => invokeApi<number>(page, 'config', 'getMasterVolume', [DISCORD])).toBe(70)
  expect(await invokeApi<number>(page, 'config', 'getMasterVolume', [LOCAL])).toBe(35)

  // Discord stays active across a restart, with its own level.
  await restart()
  await openScene()
  await expect(targetButton('Discord')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Global volume')).toHaveValue('70')

  // Back on Local, the slider shows the Local level, which also survives a restart.
  await targetButton('Local').click()
  await expect(page.getByLabel('Global volume')).toHaveValue('35')
  await expect.poll(() => invokeApi(page, 'config', 'getActiveOutputTarget')).toBe(LOCAL)

  await restart()
  await openScene()
  await expect(targetButton('Local')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Global volume')).toHaveValue('35')
  expect(await invokeApi<number>(page, 'config', 'getMasterVolume', [DISCORD])).toBe(70)
})

test('Vision to Vibe analyses an image through a keyless OpenAI-compatible server and matches Sound Tags', async () => {
  const baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`

  // Off by default: no button in the editor.
  await openScene()
  await expect(page.getByTestId('vision-to-vibe-open')).toHaveCount(0)

  await page.goto('hibiki://app/settings')
  await page.getByLabel('Vision Provider').selectOption('openai-compatible')
  await expect(page.getByLabel('Base URL')).toBeVisible()
  await page.getByLabel('Base URL').fill(baseUrl)
  await page.getByTestId('vision-save-base-url').click()
  await expect(page.getByText('Base URL saved.')).toBeVisible()
  // A non-default Base URL configures the provider without a key, which unlocks the toggle.
  await page.getByLabel('Enable Vision to Vibe').check()
  await expect(page.getByText('Vision to Vibe is on.')).toBeVisible()
  await expect.poll(() => invokeApi(page, 'config', 'getVision')).toMatchObject({
    provider: 'openai-compatible',
    enabled: true,
    configured: true,
    openaiCompatible: { keyConfigured: false, baseUrl },
  })

  await openScene()
  await page.getByTestId('vision-to-vibe-open').click()
  const dialog = page.getByRole('dialog', { name: 'Vision to Vibe' })
  await expect(dialog.getByText(`The image is sent to ${baseUrl}`)).toBeVisible()
  // The native file picker cannot be driven; answer it from the main process instead.
  await app!.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, imagePath)
  await dialog.getByTestId('vibe-pick-image').click()

  await expect(dialog.getByText(VIBE.description)).toBeVisible()
  await expect(dialog.getByRole('list', { name: 'Vibe tags' }).getByRole('listitem')).toHaveText(VIBE.tags)
  await expect(dialog.getByTestId('vibe-music-matches').locator('.match-name')).toHaveText([SOUNDS.music[0].name])
  await expect(dialog.getByTestId('vibe-ambience-matches').locator('.match-name')).toHaveText([SOUNDS.ambience[0].name])

  // Exactly one request, carrying the image once and no key.
  expect(providerRequests).toHaveLength(1)
  const [request] = providerRequests
  expect(request.url).toBe('/v1/chat/completions')
  expect(request.authorization).toBeUndefined()
  const image = PNG.toString('base64')
  expect(request.body.split(image)).toHaveLength(2)
  expect(JSON.parse(request.body).messages[0].content).toContainEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } })

  // The analysis is logged, the image and any key are not.
  await expect.poll(logText).toContain('Vision analysis returned 2 tag(s)')
  const log = logText()
  expect(log).toContain('Update check skipped: turned off in Settings')
  expect(log).not.toContain('Checking GitHub for a release')
  expect(log).not.toContain(image)
  expect(log).not.toMatch(/Bearer|Authorization/i)

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('with Vision to Vibe switched off the button is gone and the backend refuses to analyse', async () => {
  await page.goto('hibiki://app/settings')
  await page.getByLabel('Enable Vision to Vibe').uncheck()
  await expect(page.getByText('Vision to Vibe is off.')).toBeVisible()
  await expect.poll(async () => (await invokeApi<{ enabled: boolean }>(page, 'config', 'getVision')).enabled).toBe(false)

  await openScene()
  await expect(page.getByTestId('vision-to-vibe-open')).toHaveCount(0)

  const requestsBefore = providerRequests.length
  await expect(invokeApi(page, 'vision', 'analyzeImageVibe', [imagePath])).rejects.toThrow(/turned off/)
  expect(providerRequests).toHaveLength(requestsBefore)
})
