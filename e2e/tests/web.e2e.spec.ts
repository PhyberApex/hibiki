import type { ElectronApplication, Page } from '@playwright/test'
import type { Client } from 'discord.js'
import type { AudioCapture } from '../sidecar-helper.js'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, expect } from '@playwright/test'
import {
  closeElectronApp,
  getMainWindow,
  invokeApi,
  launchElectronApp,
} from '../electron-test-utils.js'
import { createMinimalWavPath } from '../fixtures/minimal-wav.js'
import { e2eEnv, isE2eConfigured, isSidecarConfigured } from '../setup.js'
import {
  captureAudioFrom,
  createSidecarClient,
  destroySidecarClient,
  voiceChannelOf,
  waitForHibikiUserId,
} from '../sidecar-helper.js'

const { guildId, voiceChannelId } = e2eEnv
const LOCAL = 'local'

interface ElectronTestFixtures {
  electronApp: ElectronApplication
  page: Page
}

const test = base.extend<ElectronTestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const app = await launchElectronApp()
    await use(app)
    await closeElectronApp(app)
  },
  page: async ({ electronApp }, use) => {
    const window = await getMainWindow(electronApp)
    await use(window)
  },
})

test.describe('Hibiki Electron E2E', () => {
  let sidecar: Client | null = null

  // A configured sidecar that cannot connect is a failure, not a downgrade:
  // silently skipping the Discord-side checks is how a green run hides a bot
  // that never joined or never sent audio.
  test.beforeAll(async () => {
    if (!isSidecarConfigured())
      return
    sidecar = await createSidecarClient()
  })

  test.afterAll(() => {
    destroySidecarClient(sidecar)
  })

  interface VoiceVerifier {
    hibikiUserId: string
    expectInVoice: (channelId: string | null) => Promise<void>
  }

  /** Discord-side view of Hibiki through the sidecar; null when no sidecar is configured. */
  async function voiceVerifier(page: Page): Promise<VoiceVerifier | null> {
    if (!sidecar)
      return null
    const hibikiUserId = await waitForHibikiUserId(page)
    const client = sidecar
    return {
      hibikiUserId,
      expectInVoice: async (channelId) => {
        await expect.poll(() => voiceChannelOf(client, guildId, hibikiUserId), { timeout: 10_000 }).toBe(channelId)
      },
    }
  }

  test('app loads Scenes view', async ({ page }) => {
    await page.goto('hibiki://app/scenes')
    await expect(page.getByRole('link', { name: 'Scenes' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Media' })).toBeVisible()
  })

  test('app loads Sound library', async ({ page }) => {
    await page.goto('hibiki://app/media')
    await expect(page.getByRole('heading', { name: 'Sound library' })).toBeVisible()
    await expect(page.locator('.category-tab', { hasText: 'Music' })).toBeVisible()
    await expect(page.locator('.category-tab', { hasText: 'Effects' })).toBeVisible()
    await expect(page.locator('section.panel')).toBeVisible()
  })

  /** The sidebar entry for the configured E2E voice channel, once the guild directory has loaded. */
  async function configuredChannelItem(page: Page) {
    await page.locator('.channel-item').first().waitFor({ timeout: 30_000 })
    const directory = await invokeApi<{ guildId: string, channels: { id: string, name: string }[] }[]>(page, 'player', 'getGuildDirectory')
    const channel = directory.find(g => g.guildId === guildId)?.channels.find(c => c.id === voiceChannelId)
    if (!channel)
      throw new Error(`Voice channel ${voiceChannelId} not found in guild ${guildId} directory`)
    return page.locator('.channel-item', { hasText: channel.name }).first()
  }

  test('join voice channel', async ({ page }) => {
    if (!isE2eConfigured())
      test.skip()

    const verifier = await voiceVerifier(page)
    await page.goto('hibiki://app/scenes')
    await expect(page.getByRole('link', { name: 'Scenes' })).toBeVisible()

    await (await configuredChannelItem(page)).click()
    await expect(page.locator('.btn-disconnect')).toBeVisible({ timeout: 15_000 })

    await verifier?.expectInVoice(voiceChannelId)
  })

  test('leave voice channel', async ({ page }) => {
    if (!isE2eConfigured())
      test.skip()

    const verifier = await voiceVerifier(page)
    await page.goto('hibiki://app/scenes')

    await (await configuredChannelItem(page)).click()
    await expect(page.locator('.btn-disconnect')).toBeVisible({ timeout: 15_000 })
    await verifier?.expectInVoice(voiceChannelId)

    await page.locator('.btn-disconnect').click()
    await expect(page.locator('.btn-disconnect')).not.toBeVisible({ timeout: 5000 })

    await verifier?.expectInVoice(null)
  })

  test('music played to Discord reaches another member of the voice channel', async ({ page }) => {
    if (!isE2eConfigured() || !isSidecarConfigured())
      test.skip()

    const verifier = (await voiceVerifier(page))!
    const timestamp = String(Date.now())
    const unique = `e2e-discord-playback-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`, 20)
    let soundId: string | undefined
    let capture: Awaited<ReturnType<typeof captureAudioFrom>> | undefined
    try {
      await page.goto('hibiki://app/media')
      await page.locator('.category-tab', { hasText: 'Music' }).click()
      await page.locator('section.panel input[type=file]').setInputFiles(wavPath)
      await expect(page.locator('.toast-region').getByText('Added to music.')).toBeVisible({ timeout: 15_000 })
      const music = await invokeApi<Array<{ id: string }>>(page, 'sounds', 'listMusic')
      soundId = music.find(s => s.id.toLowerCase().includes(unique.toLowerCase()))?.id
      expect(soundId).toBeTruthy()

      await page.locator('.channel-item').first().waitFor({ timeout: 30_000 })
      await invokeApi(page, 'player', 'join', [{ guildId, channelId: voiceChannelId }])
      await verifier.expectInVoice(voiceChannelId)

      capture = await captureAudioFrom(sidecar!, guildId, voiceChannelId, verifier.hibikiUserId)
      await invokeApi(page, 'player', 'playMusic', [guildId, soundId, { volume: 100, loop: true }])

      await expect.poll(async () => {
        const states = await invokeApi<Array<{ targetId: string, track: { id: string } | null }>>(page, 'player', 'getState')
        return states.find(s => s.targetId === guildId)?.track?.id
      }).toBe(soundId)

      await expect(capture.speaking).resolves.toBeUndefined()
      // Roughly 50 packets per second; a handful is enough to show audio flows, not just a speaking flag.
      await expect.poll(() => capture!.packetCount(), { timeout: 15_000 }).toBeGreaterThanOrEqual(25)

      await invokeApi(page, 'player', 'stop', [guildId])
      await invokeApi(page, 'player', 'leave', [{ guildId }])
      await verifier.expectInVoice(null)
    }
    finally {
      capture?.stop()
      if (soundId)
        await invokeApi(page, 'sounds', 'deleteSound', ['music', soundId]).catch(() => undefined)
      if (existsSync(wavPath))
        unlinkSync(wavPath)
    }
  })

  type SoundCategory = 'music' | 'ambience' | 'effects'

  interface PlaybackState {
    targetId: string
    track: { id: string } | null
    ambience?: string[]
    effects?: { instanceId: string, soundId: string }[]
  }

  async function targetState(page: Page, targetId: string): Promise<PlaybackState | undefined> {
    const states = await invokeApi<PlaybackState[]>(page, 'player', 'getState')
    return states.find(s => s.targetId === targetId)
  }

  /** Writes a silent WAV of `seconds` and uploads it through the sounds API; returns the stored sound id. */
  async function uploadWav(page: Page, category: SoundCategory, filename: string, seconds: number): Promise<string> {
    const wavPath = createMinimalWavPath(filename, seconds)
    try {
      const saved = await page.evaluate(async ({ category, base64, name }) => {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        return (window as any).hibiki.invoke('api', { domain: 'sounds', method: 'uploadSound', args: [category, bytes.buffer, name] }) as Promise<{ id: string }>
      }, { category, base64: readFileSync(wavPath).toString('base64'), name: filename })
      return saved.id
    }
    finally {
      if (existsSync(wavPath))
        unlinkSync(wavPath)
    }
  }

  /** Returns a reader for what `hibiki.log` gained after this call, so a test only sees its own lines. */
  async function logSinceNow(electronApp: ElectronApplication): Promise<() => string> {
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const path = join(userData, 'logs', 'hibiki.log')
    const read = () => (existsSync(path) ? readFileSync(path) : Buffer.alloc(0))
    const start = read().length
    return () => read().subarray(start).toString('utf8')
  }

  /**
   * Resolves once Discord has marked Hibiki as no longer speaking and no packet
   * arrived for `quietMs` after that, so a single late packet cannot pass for silence.
   */
  async function waitForQuiet(capture: AudioCapture, timeoutMs: number, quietMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs + quietMs
    let count = capture.packetCount()
    let quietSince = Date.now()
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50))
      const now = capture.packetCount()
      if (now !== count) {
        count = now
        quietSince = Date.now()
        continue
      }
      if (!capture.isSpeaking() && Date.now() - quietSince >= quietMs)
        return
    }
    throw new Error(`Hibiki was still speaking ${timeoutMs} ms later (${capture.packetCount()} packets received so far)`)
  }

  /** The Output Target the renderer's Playing Scene is on (`playingSceneMode` in the player store). */
  async function playingSceneMode(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const app = (document.querySelector('#app') as any).__vue_app__
      return app.config.globalProperties.$pinia.state.value.player.playingSceneMode as string | null
    })
  }

  test('ambience and effects played to Discord reach another member and stop', async ({ electronApp, page }) => {
    if (!isE2eConfigured() || !isSidecarConfigured())
      test.skip()
    test.setTimeout(120_000)

    const verifier = (await voiceVerifier(page))!
    const log = await logSinceNow(electronApp)
    const unique = `e2e-discord-layers-${Date.now()}`
    const EFFECT_SECONDS = 3
    const uploaded: [SoundCategory, string][] = []
    let capture: AudioCapture | undefined
    try {
      const ambienceId = await uploadWav(page, 'ambience', `${unique}-ambience.wav`, 20)
      uploaded.push(['ambience', ambienceId])
      const effectId = await uploadWav(page, 'effects', `${unique}-effect.wav`, EFFECT_SECONDS)
      uploaded.push(['effects', effectId])

      await page.locator('.channel-item').first().waitFor({ timeout: 30_000 })
      await invokeApi(page, 'player', 'join', [{ guildId, channelId: voiceChannelId }])
      await verifier.expectInVoice(voiceChannelId)
      capture = await captureAudioFrom(sidecar!, guildId, voiceChannelId, verifier.hibikiUserId)

      // Ambience: interval repeats with a 0-0 s gap, a separate mixer path from Music.
      await invokeApi(page, 'player', 'playAmbience', [guildId, ambienceId, { volume: 100, repeatMin: 0, repeatMax: 0 }])
      await expect.poll(async () => (await targetState(page, guildId))?.ambience).toContain(ambienceId)
      await expect(capture.speaking).resolves.toBeUndefined()
      const ambienceStart = capture.packetCount()
      await expect.poll(() => capture!.packetCount() - ambienceStart, { timeout: 15_000 }).toBeGreaterThanOrEqual(25)

      await invokeApi(page, 'player', 'stopAmbience', [guildId, ambienceId])
      await waitForQuiet(capture, 3_000)
      await expect.poll(async () => (await targetState(page, guildId))?.ambience ?? []).not.toContain(ambienceId)

      // Effect: a one-shot layered input that ends on its own after the file.
      const effectStart = capture.packetCount()
      const effectStartedAt = Date.now()
      const instance = await invokeApi<{ instanceId: string, soundId: string } | undefined>(page, 'player', 'playEffect', [guildId, effectId, { volume: 100 }])
      expect(instance?.soundId).toBe(effectId)
      await expect.poll(() => capture!.packetCount() - effectStart, { timeout: 10_000 }).toBeGreaterThanOrEqual(25)
      await waitForQuiet(capture, EFFECT_SECONDS * 1000 + 5_000)
      // Speaking ended because the file played out, not because the effect was cut short.
      expect(Date.now() - effectStartedAt).toBeGreaterThanOrEqual(EFFECT_SECONDS * 1000 - 500)
      await expect.poll(async () => (await targetState(page, guildId))?.effects ?? []).toHaveLength(0)

      await expect.poll(log).toContain(`(${voiceChannelId}) in guild ${guildId}`)
      const text = log()
      expect(text).toMatch(new RegExp(`playAmbience ".*" \\(.*\\) in guild ${guildId}: volume 100, repeat 0-0 s`))
      expect(text).toContain(`stopAmbience ${ambienceId} in guild ${guildId}`)
      expect(text).toContain(`playEffect ${effectId} in guild ${guildId}`)
    }
    finally {
      capture?.stop()
      await invokeApi(page, 'player', 'stop', [guildId]).catch(() => undefined)
      await invokeApi(page, 'player', 'leave', [{ guildId }]).catch(() => undefined)
      for (const [category, id] of uploaded)
        await invokeApi(page, 'sounds', 'deleteSound', [category, id]).catch(() => undefined)
    }
  })

  test('switching the Output Target hands the Playing Scene over between Local and Discord', async ({ electronApp, page }) => {
    if (!isE2eConfigured() || !isSidecarConfigured())
      test.skip()
    test.setTimeout(120_000)

    const verifier = (await voiceVerifier(page))!
    const log = await logSinceNow(electronApp)
    const unique = `e2e-discord-handover-${Date.now()}`
    let musicId: string | undefined
    let sceneId: string | undefined
    let capture: AudioCapture | undefined
    const targetButton = (name: 'Discord' | 'Local') =>
      page.getByRole('group', { name: 'Output Target' }).getByRole('button', { name, exact: true })
    try {
      musicId = await uploadWav(page, 'music', `${unique}.wav`, 20)
      const scene = await invokeApi<{ id: string }>(page, 'scenes', 'save', [{
        name: `E2E Handover ${unique}`,
        music: [{ soundId: musicId, soundName: unique, volume: 80, loop: true }],
      }])
      sceneId = scene.id

      await page.goto(`hibiki://app/scenes/${sceneId}`)
      await targetButton('Discord').click()
      await expect(targetButton('Discord')).toHaveAttribute('aria-pressed', 'true')
      // The sidebar's channel list only exists under the Discord Target, so join first.
      await (await configuredChannelItem(page)).click()
      await expect(page.locator('.btn-disconnect')).toBeVisible({ timeout: 15_000 })
      await verifier.expectInVoice(voiceChannelId)
      capture = await captureAudioFrom(sidecar!, guildId, voiceChannelId, verifier.hibikiUserId)

      await targetButton('Local').click()
      await expect(targetButton('Local')).toHaveAttribute('aria-pressed', 'true')
      await page.locator('.btn-play-scene').click()
      await expect.poll(async () => (await targetState(page, LOCAL))?.track?.id).toBe(musicId)
      await expect.poll(() => playingSceneMode(page)).toBe(LOCAL)

      // Local -> Discord: the Scene restarts on Discord and Local is torn down.
      const beforeDiscord = capture.packetCount()
      await targetButton('Discord').click()
      await expect.poll(() => capture!.packetCount() - beforeDiscord, { timeout: 10_000 }).toBeGreaterThanOrEqual(25)
      await expect.poll(async () => (await targetState(page, guildId))?.track?.id).toBe(musicId)
      await expect.poll(async () => (await targetState(page, LOCAL))?.track ?? null).toBeNull()
      expect((await targetState(page, LOCAL))?.ambience ?? []).toHaveLength(0)
      await expect.poll(() => playingSceneMode(page)).toBe(guildId)

      // Discord -> Local: Hibiki goes quiet on Discord and the Scene plays locally again.
      await targetButton('Local').click()
      await waitForQuiet(capture, 5_000)
      await expect.poll(async () => (await targetState(page, LOCAL))?.track?.id).toBe(musicId)
      await expect.poll(async () => (await targetState(page, guildId))?.track ?? null).toBeNull()
      await expect.poll(() => playingSceneMode(page)).toBe(LOCAL)

      await expect.poll(log).toContain('switching Output Target local -> discord')
      expect(log()).toContain('switching Output Target discord -> local')
      expect(log()).toContain(`(${voiceChannelId}) in guild ${guildId}`)
    }
    finally {
      capture?.stop()
      await invokeApi(page, 'player', 'stop', [LOCAL]).catch(() => undefined)
      await invokeApi(page, 'player', 'stop', [guildId]).catch(() => undefined)
      await invokeApi(page, 'player', 'leave', [{ guildId }]).catch(() => undefined)
      // The Target is persisted; later tests (and launches) expect the default Discord Target.
      await invokeApi(page, 'config', 'setActiveOutputTarget', ['discord']).catch(() => undefined)
      if (sceneId)
        await invokeApi(page, 'scenes', 'remove', [sceneId]).catch(() => undefined)
      if (musicId)
        await invokeApi(page, 'sounds', 'deleteSound', ['music', musicId]).catch(() => undefined)
    }
  })

  test('silence is sent to Discord at the full packet rate, not dropped', async ({ page }) => {
    if (!isE2eConfigured() || !isSidecarConfigured())
      test.skip()
    test.setTimeout(120_000)

    const verifier = (await voiceVerifier(page))!
    let musicId: string | undefined
    let capture: AudioCapture | undefined
    try {
      musicId = await uploadWav(page, 'music', `e2e-discord-silence-${Date.now()}.wav`, 20)
      await page.locator('.channel-item').first().waitFor({ timeout: 30_000 })
      await invokeApi(page, 'player', 'join', [{ guildId, channelId: voiceChannelId }])
      await verifier.expectInVoice(voiceChannelId)
      capture = await captureAudioFrom(sidecar!, guildId, voiceChannelId, verifier.hibikiUserId)

      await invokeApi(page, 'player', 'playMusic', [guildId, musicId, { volume: 100, loop: true }])
      await expect.poll(async () => (await targetState(page, guildId))?.track?.id).toBe(musicId)
      await expect(capture.speaking).resolves.toBeUndefined()
      // Let the stream settle before measuring.
      await new Promise(r => setTimeout(r, 1_000))

      // The mixer runs with `generateSilence: false`; the voice player must fill the gaps at one packet per 20 ms.
      const before = capture.packetCount()
      await new Promise(r => setTimeout(r, 2_000))
      const perSecond = (capture.packetCount() - before) / 2
      expect(perSecond, `${perSecond} packets/s over 2 s`).toBeGreaterThanOrEqual(30)
    }
    finally {
      capture?.stop()
      await invokeApi(page, 'player', 'stop', [guildId]).catch(() => undefined)
      await invokeApi(page, 'player', 'leave', [{ guildId }]).catch(() => undefined)
      if (musicId)
        await invokeApi(page, 'sounds', 'deleteSound', ['music', musicId]).catch(() => undefined)
    }
  })

  test('upload song, music list includes it', async ({ page }) => {
    const timestamp = String(Date.now())
    const unique = `e2e-upload-song-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('hibiki://app/media')
      await page.locator('.category-tab', { hasText: 'Music' }).click()
      const panel = page.locator('section.panel')
      await panel.locator('input[type=file]').setInputFiles(wavPath)
      await expect(panel.locator('li').filter({ hasText: timestamp })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.toast-region').getByText('Added to music.')).toBeVisible({ timeout: 5000 })

      const music = await invokeApi<Array<{ id: string, name: string }>>(
        page,
        'sounds',
        'listMusic',
        [],
      )
      expect(music.some(s => s.id.toLowerCase().includes(unique.toLowerCase()))).toBe(true)
    }
    finally {
      if (existsSync(wavPath))
        unlinkSync(wavPath)
    }
  })

  test('upload effect, effects list includes it', async ({ page }) => {
    const timestamp = String(Date.now())
    const unique = `e2e-upload-effect-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('hibiki://app/media')
      await page.locator('.category-tab', { hasText: 'Effects' }).click()
      const panel = page.locator('section.panel')
      await panel.locator('input[type=file]').setInputFiles(wavPath)
      await expect(panel.locator('li').filter({ hasText: timestamp })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.toast-region').getByText('Added to effects.')).toBeVisible({ timeout: 5000 })

      const effects = await invokeApi<Array<{ id: string, name: string }>>(
        page,
        'sounds',
        'listEffects',
        [],
      )
      expect(effects.some(s => s.id.toLowerCase().includes(unique.toLowerCase()))).toBe(true)
    }
    finally {
      if (existsSync(wavPath))
        unlinkSync(wavPath)
    }
  })

  test('delete song, music list no longer shows it', async ({ page }) => {
    const timestamp = String(Date.now())
    const unique = `e2e-delete-song-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('hibiki://app/media')
      await page.locator('.category-tab', { hasText: 'Music' }).click()
      const panel = page.locator('section.panel')
      await panel.locator('input[type=file]').setInputFiles(wavPath)
      const listItem = panel.locator('li').filter({ hasText: timestamp })
      await expect(listItem).toBeVisible({ timeout: 15_000 })

      // Click the × delete button, then confirm with "Delete"
      await listItem.locator('.btn-delete').click()
      await listItem.locator('.btn-confirm-delete').click()
      await expect(page.locator('.toast-region').getByText('Removed from library.')).toBeVisible({ timeout: 5000 })

      const music = await invokeApi<Array<{ id: string, name: string }>>(
        page,
        'sounds',
        'listMusic',
        [],
      )
      expect(music.some(s => s.id.toLowerCase().includes(unique.toLowerCase()))).toBe(false)
    }
    finally {
      if (existsSync(wavPath))
        unlinkSync(wavPath)
    }
  })

  test('delete effect, effects list no longer shows it', async ({ page }) => {
    const timestamp = String(Date.now())
    const unique = `e2e-delete-effect-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('hibiki://app/media')
      await page.locator('.category-tab', { hasText: 'Effects' }).click()
      const panel = page.locator('section.panel')
      await panel.locator('input[type=file]').setInputFiles(wavPath)
      const listItem = panel.locator('li').filter({ hasText: timestamp })
      await expect(listItem).toBeVisible({ timeout: 15_000 })

      // Click the × delete button, then confirm with "Delete"
      await listItem.locator('.btn-delete').click()
      await listItem.locator('.btn-confirm-delete').click()
      await expect(page.locator('.toast-region').getByText('Removed from library.')).toBeVisible({ timeout: 5000 })

      const effects = await invokeApi<Array<{ id: string, name: string }>>(
        page,
        'sounds',
        'listEffects',
        [],
      )
      expect(effects.some(s => s.id.toLowerCase().includes(unique.toLowerCase()))).toBe(false)
    }
    finally {
      if (existsSync(wavPath))
        unlinkSync(wavPath)
    }
  })
})
