import type { ElectronApplication, Page } from '@playwright/test'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, invokeApi, launchElectronApp } from '../electron-test-utils.js'
import { writeMinimalWav } from '../fixtures/minimal-wav.js'

/**
 * A GM browses the community Scene Registry and installs a Scene from it.
 * `HIBIKI_REGISTRY_INDEX_URL` points the app at a local `http.Server` serving
 * a fake `index.json`, so the real index fetch, the Registry browser and the
 * install run end to end without the network. Registry entries carry no
 * audio (`audioBundled: false`): an installed Scene references its sounds by
 * name, they show as missing until the GM resolves them against their own
 * library, and any Hotkey in the entry is dropped. Runs on the Local Target
 * and needs no Discord token.
 */

const SCENE_NAME = 'E2e Haunted Crypt'
const SLUG = 'e2e-haunted-crypt'
const MUSIC = { soundName: 'Crypt Drone', volume: 55, loop: true }
const AMBIENCE = { soundName: 'Dripping Water', volume: 25, enabled: true }
const EFFECT = { soundName: 'Coffin Creak', volume: 85 }
/** In the GM's library: what the missing Effect gets mapped to. */
const LIBRARY_EFFECT_ID = 'e2e-registry-creak'
const LIBRARY_EFFECT_NAME = 'E2e Registry Creak'

const source = (name: string) => ({ name, url: 'https://example.invalid/sound', note: 'e2e fixture' })

const INDEX = {
  version: 1,
  updatedAt: '2026-10-01T00:00:00Z',
  scenes: [
    {
      name: SCENE_NAME,
      slug: SLUG,
      description: 'Cold stone, slow drips and something stirring in the dark.',
      author: 'e2e',
      version: '1.0.0',
      tags: ['horror', 'dungeon'],
      category: 'dungeon',
      license: 'CC0-1.0',
      audioBundled: false,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      // A Hotkey is machine-local: the install must not carry it over.
      hotkey: 'F13',
      scene: {
        musicMode: 'shuffle',
        music: [
          {
            ...MUSIC,
            source: source('Crypt Drone'),
          },
        ],
        ambience: [
          {
            ...AMBIENCE,
            source: source('Dripping Water'),
          },
        ],
        effects: [
          {
            ...EFFECT,
            hotkey: 'F14',
            source: source('Coffin Creak'),
          },
        ],
      },
    },
  ],
}

interface SceneItem {
  soundId: string
  soundName?: string
  volume: number
  enabled?: boolean
  loop?: boolean
  hotkey?: string
}

interface Scene {
  id: string
  name: string
  musicMode?: string
  hotkey?: string
  music: SceneItem[]
  ambience: SceneItem[]
  effects: SceneItem[]
}

let profile: string
let app: ElectronApplication | undefined
let page: Page
const requests: string[] = []
const indexServer = createServer((req, res) => {
  requests.push(req.url ?? '')
  if (req.url === '/registry/index.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(INDEX))
    return
  }
  res.writeHead(404)
  res.end()
})

function seed(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hibiki-e2e-registry-'))
  mkdirSync(join(dir, 'data'), { recursive: true })
  for (const category of ['music', 'ambience', 'effects'])
    mkdirSync(join(dir, 'storage', category), { recursive: true })
  writeMinimalWav(join(dir, 'storage', 'effects', `${LIBRARY_EFFECT_ID}.wav`), 1)
  writeFileSync(join(dir, 'data', 'scenes.json'), JSON.stringify([]))
  // The launch update check would GET GitHub; keep the run off the network.
  writeFileSync(join(dir, 'data', 'app-config.json'), JSON.stringify({
    updates: JSON.stringify({ enabled: false }),
  }))
  return dir
}

function logText(): string {
  try {
    return readFileSync(join(profile, 'logs', 'hibiki.log'), 'utf8')
  }
  catch {
    return ''
  }
}

test.beforeAll(async () => {
  await new Promise<void>(resolve => indexServer.listen(0, '127.0.0.1', resolve))
  profile = seed()
})

test.afterAll(async () => {
  if (app)
    await closeElectronApp(app)
  await new Promise<void>(resolve => indexServer.close(() => resolve()))
  if (profile)
    rmSync(profile, { recursive: true, force: true })
})

test('a Scene installed from the Registry browser lands in the Scenes view, its sounds resolvable', async () => {
  test.setTimeout(180_000)
  const indexUrl = `http://127.0.0.1:${(indexServer.address() as AddressInfo).port}/registry/index.json`
  let installed!: Scene

  await test.step('the app fetches the index from HIBIKI_REGISTRY_INDEX_URL and lists its entry', async () => {
    app = await launchElectronApp({
      // Pinned to empty rather than stripped: the backend's dotenv only fills missing variables.
      env: {
        DISCORD_TOKEN: '',
        HIBIKI_VISION_API_KEY: '',
        HIBIKI_VISION_OPENAI_API_KEY: '',
        HIBIKI_USER_DATA_DIR: profile,
        HIBIKI_STORAGE_PATH: join(profile, 'storage'),
        HIBIKI_REGISTRY_INDEX_URL: indexUrl,
      },
    })
    page = await getMainWindow(app)
    await page.getByRole('button', { name: /Play at the table/ }).click()
    await expect(page.getByRole('heading', { name: 'Scenes', exact: true })).toBeVisible()
    await expect.poll(logText).toContain(`Scene Registry index overridden by HIBIKI_REGISTRY_INDEX_URL: ${indexUrl}`)

    await page.getByRole('button', { name: 'Browse community scenes' }).click()
    const registryDialog = page.getByRole('dialog', { name: 'Browse Community Scenes' })
    await expect(registryDialog).toBeVisible()
    await expect(registryDialog.getByText(SCENE_NAME, { exact: true })).toBeVisible()
    await expect(registryDialog.getByText('by e2e', { exact: true })).toBeVisible()
    expect(requests).toEqual(['/registry/index.json'])
    // The index contents stay out of the log; only its URL and size go in.
    expect(logText()).not.toContain(INDEX.scenes[0].description)
  })

  await test.step('Install adds the Scene, opens it and drops the entry\'s Hotkeys', async () => {
    const registryDialog = page.getByRole('dialog', { name: 'Browse Community Scenes' })
    await registryDialog.getByRole('button', { name: 'Install' }).click()
    await expect(registryDialog).toBeHidden()
    await expect(page).toHaveURL(/hibiki:\/\/app\/scenes\/[^/]+$/)
    await expect(page.getByRole('heading', { name: SCENE_NAME, exact: true })).toBeVisible()

    const id = decodeURIComponent(page.url().split('/').pop()!)
    installed = await invokeApi<Scene>(page, 'scenes', 'get', [id])
    expect(installed.name).toBe(SCENE_NAME)
    expect(installed.musicMode).toBe('shuffle')
    expect(installed.hotkey).toBeUndefined()
    expect(installed.music).toEqual([
      {
        soundId: MUSIC.soundName,
        ...MUSIC,
        source: source('Crypt Drone'),
      },
    ])
    expect(installed.ambience).toEqual([
      {
        soundId: AMBIENCE.soundName,
        ...AMBIENCE,
        source: source('Dripping Water'),
      },
    ])
    expect(installed.effects).toEqual([
      {
        soundId: EFFECT.soundName,
        ...EFFECT,
        source: source('Coffin Creak'),
      },
    ])
    expect((await invokeApi<Scene[]>(page, 'scenes', 'list')).map(s => s.name)).toEqual([SCENE_NAME])

    // The browser already had the index: installing read it from the cache, no second fetch.
    expect(requests).toEqual(['/registry/index.json'])
    const cache = JSON.parse(readFileSync(join(profile, 'data', 'registry-cache.json'), 'utf8'))
    expect(cache).toMatchObject({
      url: indexUrl,
      data: {
        scenes: [
          { slug: SLUG },
        ],
      },
    })
    await expect.poll(logText).toContain(`Installed "${SCENE_NAME}" from registry (${installed.id})`)

    await page.goto('hibiki://app/scenes')
    await page.getByText(SCENE_NAME, { exact: true }).click()
    await expect(page).toHaveURL(`hibiki://app/scenes/${installed.id}`)
    await expect(page.getByRole('heading', { name: SCENE_NAME, exact: true })).toBeVisible()
  })

  await test.step('its sounds show as missing until resolved against the GM\'s library', async () => {
    await expect(page.getByText('missing', { exact: true })).toHaveCount(3)
    await expect(page.getByRole('button', { name: /^Scene Hotkey: not set\./ })).toBeVisible()

    // The Effect card's Resolve button; Music and Ambience rows have their own "Resolve missing sound...".
    await page.getByRole('button', { name: 'Resolve…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Resolve missing sound: ${EFFECT.soundName}` })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('combobox').selectOption(LIBRARY_EFFECT_ID)
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await invokeApi<Scene>(page, 'scenes', 'get', [installed.id])).effects)
      .toEqual([
        {
          soundId: LIBRARY_EFFECT_ID,
          soundName: LIBRARY_EFFECT_NAME,
          volume: EFFECT.volume,
          source: source('Coffin Creak'),
        },
      ])
    await expect(page.getByText('missing', { exact: true })).toHaveCount(2)
    await expect(page.getByTitle(`Play ${LIBRARY_EFFECT_NAME}`)).toBeEnabled()
  })
})
