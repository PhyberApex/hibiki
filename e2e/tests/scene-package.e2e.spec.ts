import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import AdmZip from 'adm-zip'
import { closeElectronApp, getMainWindow, invokeApi, launchElectronApp } from '../electron-test-utils.js'
import { writeMinimalWav } from '../fixtures/minimal-wav.js'

/**
 * A `.hibiki.zip` made by one profile loads in another. Profile A exports a
 * Scene with Music, Ambience, an Effect and both kinds of Hotkey; a second,
 * empty profile B imports it through the Scenes view three times: once
 * clean, once as a duplicate, and once with a sound file taken out so the
 * missing sound has to be resolved against B's library. The OS file picker
 * is stubbed in the main process, since Playwright cannot drive a native
 * dialog. Needs no Discord token.
 */

const SCENE_NAME = 'Pkg Scene'
const MUSIC = { id: 'e2e-pkg-music', name: 'Tavern Theme', volume: 40 }
const AMBIENCE = { id: 'e2e-pkg-ambience', name: 'Rain', volume: 65 }
const EFFECT = { id: 'e2e-pkg-effect', name: 'Door Slam', volume: 80 }
/** Only in profile B's library: what the missing Effect gets mapped to. */
const SPARE_EFFECT_ID = 'e2e-pkg-spare'
const SPARE_EFFECT_NAME = 'E2e Pkg Spare'

const SOUNDS = [
  ['music', MUSIC],
  ['ambience', AMBIENCE],
  ['effects', EFFECT],
] as const

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
  hotkey?: string
  music: SceneItem[]
  ambience: SceneItem[]
  effects: SceneItem[]
}

let root: string
let app: ElectronApplication | undefined
let page: Page

function seedProfile(name: string, scenes: unknown[], sounds: [string, string][]): string {
  const dir = join(root, name)
  mkdirSync(join(dir, 'data'), { recursive: true })
  for (const category of ['music', 'ambience', 'effects'])
    mkdirSync(join(dir, 'storage', category), { recursive: true })
  for (const [category, id] of sounds)
    writeMinimalWav(join(dir, 'storage', category, `${id}.wav`), 1)
  writeFileSync(join(dir, 'data', 'scenes.json'), JSON.stringify(scenes))
  writeFileSync(join(dir, 'data', 'app-config.json'), JSON.stringify({}))
  return dir
}

async function launch(profile: string): Promise<void> {
  app = await launchElectronApp({
    // Pinned to empty rather than stripped: the backend's dotenv only fills missing variables.
    env: {
      DISCORD_TOKEN: '',
      HIBIKI_VISION_API_KEY: '',
      HIBIKI_VISION_OPENAI_API_KEY: '',
      HIBIKI_USER_DATA_DIR: profile,
      HIBIKI_STORAGE_PATH: join(profile, 'storage'),
    },
  })
  page = await getMainWindow(app)
  await page.getByRole('button', { name: /Play at the table/ }).click()
  await expect(page.getByRole('heading', { name: 'Scenes', exact: true })).toBeVisible()
}

async function close(): Promise<void> {
  if (app)
    await closeElectronApp(app)
  app = undefined
}

/** Makes every "Open file" dialog from now on pick `path`, as the GM would in the OS file picker. */
async function stubOpenDialog(path: string): Promise<void> {
  await app!.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [picked],
    })) as typeof dialog.showOpenDialog
  }, path)
}

/** Imports `archive` through the Scenes list's Import button and returns the Scene it opened. */
async function importThroughUi(archive: string): Promise<Scene> {
  await page.goto('hibiki://app/scenes')
  await stubOpenDialog(archive)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page).toHaveURL(/hibiki:\/\/app\/scenes\/[^/]+$/)
  const id = decodeURIComponent(page.url().split('/').pop()!)
  return invokeApi<Scene>(page, 'scenes', 'get', [id])
}

function storedFiles(profile: string): Record<string, Record<string, string>> {
  const files: Record<string, Record<string, string>> = {}
  for (const category of ['music', 'ambience', 'effects']) {
    const dir = join(profile, 'storage', category)
    files[category] = Object.fromEntries(readdirSync(dir).sort().map(f => [
      f,
      readFileSync(join(dir, f)).toString('base64'),
    ]))
  }
  return files
}

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'hibiki-e2e-scene-package-'))
})

test.afterAll(async () => {
  await close()
  if (root)
    rmSync(root, { recursive: true, force: true })
})

test('a .hibiki.zip exported by one profile imports into another, duplicates and missing sounds included', async () => {
  test.setTimeout(240_000)
  const archive = join(root, 'pkg-scene.hibiki.zip')
  const trimmedArchive = join(root, 'pkg-scene-without-effect.hibiki.zip')
  const item = (sound: { id: string, name: string, volume: number }, extra = {}) =>
    ({
      soundId: sound.id,
      soundName: sound.name,
      volume: sound.volume,
      ...extra,
    })

  await test.step('profile A exports a Scene without its Hotkeys', async () => {
    const profileA = seedProfile('profile-a', [
      {
        id: 'e2e-pkg-scene',
        name: SCENE_NAME,
        hotkey: 'F13',
        music: [
          item(MUSIC, { loop: true }),
        ],
        ambience: [
          item(AMBIENCE, { enabled: true }),
        ],
        effects: [
          item(EFFECT, { hotkey: 'F14' }),
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ], SOUNDS.map(([category, sound]) => [category, sound.id]))
    await launch(profileA)
    // The save dialog is OS-native, so the export is asked for directly with a path.
    await invokeApi(page, 'scenes', 'exportScene', ['e2e-pkg-scene', archive])
    await close()

    const zip = new AdmZip(archive)
    expect(zip.getEntries().map(e => e.entryName).sort()).toEqual([
      'hibiki-scene.json',
      ...SOUNDS.map(([category, sound]) => `sounds/${category}/${sound.id}.wav`),
    ].sort())
    const manifestText = zip.readAsText('hibiki-scene.json')
    expect(manifestText).not.toContain('hotkey')
    const manifest = JSON.parse(manifestText)
    expect(manifest.displayName).toBe(SCENE_NAME)
    expect(manifest.scene.music[0]).toMatchObject({
      soundName: MUSIC.name,
      volume: MUSIC.volume,
      loop: true,
      bundled: true,
    })
    expect(manifest.scene.ambience[0]).toMatchObject({
      soundName: AMBIENCE.name,
      volume: AMBIENCE.volume,
      enabled: true,
      bundled: true,
    })
    expect(manifest.scene.effects[0]).toMatchObject({ soundName: EFFECT.name, volume: EFFECT.volume, bundled: true })

    // What an export writes when the Effect's file is gone from the library: no file, not bundled.
    zip.deleteFile(`sounds/effects/${EFFECT.id}.wav`)
    manifest.scene.effects[0] = { soundName: EFFECT.name, volume: EFFECT.volume, bundled: false }
    zip.updateFile('hibiki-scene.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))
    zip.writeZip(trimmedArchive)
  })

  const profileB = seedProfile('profile-b', [], [
    ['effects', SPARE_EFFECT_ID],
  ])
  await launch(profileB)
  let first!: Scene

  await test.step('profile B imports it with the same items and volumes, and no Hotkeys', async () => {
    first = await importThroughUi(archive)
    await expect(page.getByText(`Imported "${SCENE_NAME}"`)).toBeVisible()
    await expect(page.getByRole('heading', { name: SCENE_NAME, exact: true })).toBeVisible()

    expect(first.name).toBe(SCENE_NAME)
    expect(first.hotkey).toBeUndefined()
    expect(first.music).toEqual([
      item(MUSIC, { loop: true }),
    ])
    expect(first.ambience).toEqual([
      item(AMBIENCE, { enabled: true }),
    ])
    expect(first.effects).toEqual([
      item(EFFECT),
    ])

    await expect(page.getByLabel(`Volume for ${MUSIC.name}`)).toHaveValue(String(MUSIC.volume))
    await expect(page.getByLabel(`Volume for ${AMBIENCE.name}`)).toHaveValue(String(AMBIENCE.volume))
    await expect(page.getByLabel(`Loop ${MUSIC.name}`)).toBeChecked()
    await expect(page.getByLabel(`Enable ${AMBIENCE.name}`)).toBeChecked()
    await expect(page.getByRole('button', { name: `Play ${MUSIC.name}` })).toBeVisible()
    await expect(page.getByTitle(`Play ${EFFECT.name}`)).toBeEnabled()
    await expect(page.getByText('missing', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Scene Hotkey: not set\./ })).toBeVisible()
    await expect(page.getByRole('button', {
      name: new RegExp(`^Effect Hotkey for ${EFFECT.name}: not set\\.`),
    })).toBeVisible()

    const files = storedFiles(profileB)
    for (const [category, sound] of SOUNDS)
      expect(Object.keys(files[category])).toContain(`${sound.id}.wav`)
  })

  await test.step('importing it again adds a renamed copy sharing the same sound files', async () => {
    const before = storedFiles(profileB)
    const second = await importThroughUi(archive)
    const copyName = `${SCENE_NAME} (imported)`
    await expect(page.getByText(`Imported "${copyName}"`)).toBeVisible()

    expect(second.id).not.toBe(first.id)
    expect(second.name).toBe(copyName)
    expect(second.music).toEqual(first.music)
    expect(second.ambience).toEqual(first.ambience)
    expect(second.effects).toEqual(first.effects)
    expect(await invokeApi<Scene>(page, 'scenes', 'get', [first.id])).toMatchObject({
      name: SCENE_NAME,
      music: first.music,
      ambience: first.ambience,
      effects: first.effects,
    })
    expect((await invokeApi<Scene[]>(page, 'scenes', 'list')).map(s => s.name).sort()).toEqual([SCENE_NAME, copyName])
    // The bundled sounds keep their ids: the import rewrites the same files with the same bytes, adding none.
    expect(storedFiles(profileB)).toEqual(before)
  })

  await test.step('an archive missing a sound file asks for it, and the mapped sound is saved', async () => {
    const third = await importThroughUi(trimmedArchive)
    await expect(page.getByText(`Imported "${third.name}"`)).toBeVisible()
    expect(third.effects).toEqual([
      { soundId: EFFECT.name, soundName: EFFECT.name, volume: EFFECT.volume },
    ])
    expect(third.music).toEqual(first.music)

    await expect(page.getByText('missing', { exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: 'Resolve…' }).click()
    const dialog = page.getByRole('dialog', { name: `Resolve missing sound: ${EFFECT.name}` })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('combobox').selectOption(SPARE_EFFECT_ID)
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await invokeApi<Scene>(page, 'scenes', 'get', [third.id])).effects)
      .toEqual([
        { soundId: SPARE_EFFECT_ID, soundName: SPARE_EFFECT_NAME, volume: EFFECT.volume },
      ])
    await expect(page.getByText('missing', { exact: true })).toHaveCount(0)
  })
})
