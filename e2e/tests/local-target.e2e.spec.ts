import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, invokeApi, launchElectronApp } from '../electron-test-utils.js'
import { writeMinimalWav } from '../fixtures/minimal-wav.js'

/**
 * Plays a seeded Scene through the Local Target (ADR-0004). Needs no Discord
 * token, so it runs on every PR; decoding, mixing and the renderer-sink
 * round-trip are all exercised for real.
 */

const LOCAL = 'local'
const MUSIC_ID = 'e2e-music'
const AMBIENCE_ID = 'e2e-ambience'
const EFFECT_ID = 'e2e-effect'
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
  const root = mkdtempSync(join(tmpdir(), 'hibiki-e2e-local-'))
  const dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })
  const files: [string, string, number][] = [
    ['music', MUSIC_ID, 10],
    ['ambience', AMBIENCE_ID, 10],
    ['effects', EFFECT_ID, EFFECT_SECONDS],
  ]
  for (const [category, id, seconds] of files) {
    mkdirSync(join(root, 'storage', category), { recursive: true })
    writeMinimalWav(join(root, 'storage', category, `${id}.wav`), seconds)
  }
  const item = (soundId: string, extra = {}) => ({
    soundId,
    soundName: soundId,
    volume: 50,
    ...extra,
  })
  const scene = {
    id: 'e2e-local-scene',
    name: 'E2E Local Scene',
    music: [
      item(MUSIC_ID, { loop: true }),
    ],
    ambience: [
      item(AMBIENCE_ID, { enabled: true, repeatMin: 0, repeatMax: 0 }),
    ],
    effects: [
      item(EFFECT_ID),
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  writeFileSync(join(dataDir, 'scenes.json'), JSON.stringify([scene]))
  writeFileSync(join(dataDir, 'app-config.json'), JSON.stringify({}))
  return root
}

async function localState(): Promise<PlaybackState | undefined> {
  const states = await invokeApi<PlaybackState[]>(page, 'player', 'getState')
  return states.find(s => s.targetId === LOCAL)
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

test('plays a Scene through the Local Target without Discord', async () => {
  const scenes = await invokeApi<{ id: string, music: any[], ambience: any[], effects: any[] }[]>(page, 'scenes', 'list')
  const scene = scenes.find(s => s.id === 'e2e-local-scene')!
  expect(scene).toBeTruthy()

  await invokeApi(page, 'config', 'setActiveOutputTarget', [LOCAL])
  expect(await invokeApi(page, 'config', 'getActiveOutputTarget')).toBe(LOCAL)

  const music = scene.music[0]
  const ambience = scene.ambience[0]
  await invokeApi(page, 'player', 'playMusic', [
    LOCAL,
    music.soundId,
    { volume: music.volume, loop: true },
  ])
  await invokeApi(page, 'player', 'playAmbience', [
    LOCAL,
    ambience.soundId,
    { volume: ambience.volume, repeatMin: 0, repeatMax: 0 },
  ])

  await expect.poll(async () => (await localState())?.track?.id).toBe(MUSIC_ID)
  await expect.poll(async () => (await localState())?.ambience).toContain(AMBIENCE_ID)

  const instance = await invokeApi<{ instanceId: string, soundId: string } | undefined>(page, 'player', 'playEffect', [
    LOCAL,
    EFFECT_ID,
    { volume: 50 },
  ])
  expect(instance?.soundId).toBe(EFFECT_ID)
  await expect.poll(async () => (await localState())?.effects?.map(e => e.instanceId)).toContain(instance!.instanceId)
  // The Effect ends on its own once the sound finishes; Music and Ambience keep playing.
  await expect.poll(async () => (await localState())?.effects ?? [], { timeout: 20_000 }).toHaveLength(0)
  const after = await localState()
  expect(after?.track?.id).toBe(MUSIC_ID)
  expect(after?.ambience).toContain(AMBIENCE_ID)

  // Sink health is only logged (player.reportLocalSinkHealth), so the log is the observable.
  await expect.poll(logText).toContain('Local sink started in the renderer')
  const log = logText()
  expect(log).not.toMatch(/Local sink (failed|deviceLost)/)
  expect(log).not.toContain('Local sink AudioContext suspended')

  await invokeApi(page, 'player', 'stop', [LOCAL])
})
