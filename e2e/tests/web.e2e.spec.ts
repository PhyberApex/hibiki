import type { ElectronApplication, Page } from '@playwright/test'
import type { Client } from 'discord.js'
import { existsSync, unlinkSync } from 'node:fs'
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
