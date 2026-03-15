import type { ElectronApplication, Page } from '@playwright/test'
import type { Client } from 'discord.js'
import { existsSync, unlinkSync } from 'node:fs'
import { test as base, expect } from '@playwright/test'
import {
  getMainWindow,
  invokeApi,
  launchElectronApp,
} from '../electron-test-utils.js'
import { createMinimalWavPath } from '../fixtures/minimal-wav.js'
import { e2eEnv, isE2eConfigured, isSidecarConfigured } from '../setup.js'
import {
  createSidecarClient,
  destroySidecarClient,
} from '../sidecar-helper.js'

type VoiceChannel = import('discord.js').VoiceChannel

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
    await app.close()
  },
  page: async ({ electronApp }, use) => {
    const window = await getMainWindow(electronApp)
    await use(window)
  },
})

test.describe('Hibiki Electron E2E', () => {
  let sidecar: Client | null = null
  let hibikiUserId: string | null = null

  test.beforeAll(async () => {
    if (!isSidecarConfigured())
      return
    try {
      sidecar = await createSidecarClient()
    }
    catch (err) {
      console.warn('Sidecar client failed to connect, voice verification tests will be limited:', (err as Error).message)
    }
  })

  test.afterAll(() => {
    destroySidecarClient(sidecar)
  })

  async function ensureHibikiUserId(page: Page): Promise<void> {
    if (hibikiUserId)
      return
    if (!sidecar)
      return
    try {
      const status = await invokeApi<{ ready: boolean, userId?: string }>(
        page,
        'player',
        'getBotStatus',
        [],
      )
      if (status.ready && status.userId)
        hibikiUserId = status.userId
    }
    catch {
      // API unreachable
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
    await expect(page.locator('section.panel').filter({ hasText: 'Music' })).toBeVisible()
    await expect(page.locator('section.panel').filter({ hasText: 'Effects' })).toBeVisible()
  })

  test('join voice channel', async ({ page }) => {
    if (!isE2eConfigured())
      test.skip()

    await ensureHibikiUserId(page)
    await page.goto('hibiki://app/scenes')
    await expect(page.getByRole('link', { name: 'Scenes' })).toBeVisible()

    // Wait for bot to connect and guild directory to load
    const firstGuildChannel = page.locator('.channel-item').first()
    await firstGuildChannel.waitFor({ timeout: 30_000 })

    // Select guild/channel from sidebar
    await firstGuildChannel.click()
    await expect(page.locator('.btn-disconnect')).toBeVisible({ timeout: 15_000 })

    if (sidecar && hibikiUserId && voiceChannelId) {
      const guild = await sidecar!.guilds.fetch(guildId)
      const channel = (await guild.channels.fetch(voiceChannelId)) as VoiceChannel
      expect(channel.members.has(hibikiUserId)).toBe(true)
    }
  })

  test('leave voice channel', async ({ page }) => {
    if (!isE2eConfigured())
      test.skip()

    await ensureHibikiUserId(page)
    await page.goto('hibiki://app/scenes')

    // Wait for bot to connect and guild directory to load
    const firstGuildChannel = page.locator('.channel-item').first()
    await firstGuildChannel.waitFor({ timeout: 30_000 })

    // Join a channel first
    await firstGuildChannel.click()
    await expect(page.locator('.btn-disconnect')).toBeVisible({ timeout: 15_000 })

    // Now leave
    await page.locator('.btn-disconnect').click()
    await expect(page.locator('.btn-disconnect')).not.toBeVisible({ timeout: 5000 })

    if (sidecar && hibikiUserId && voiceChannelId) {
      await page.waitForTimeout(1500)
      const guild = await sidecar!.guilds.fetch(guildId)
      const channel = (await guild.channels.fetch(voiceChannelId)) as VoiceChannel
      expect(channel.members.has(hibikiUserId)).toBe(false)
    }
  })

  test('upload song, music list includes it', async ({ page }) => {
    const timestamp = String(Date.now())
    const unique = `e2e-upload-song-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('hibiki://app/media')
      const musicPanel = page.locator('section.panel').filter({ hasText: 'Music' })
      await musicPanel.locator('input[type=file]').setInputFiles(wavPath)
      await expect(musicPanel.locator('li').filter({ hasText: timestamp })).toBeVisible({ timeout: 15_000 })
      await expect(musicPanel.getByText('Uploaded.')).toBeVisible({ timeout: 5000 })

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
      const effectsPanel = page.locator('section.panel').filter({ hasText: 'Effects' })
      await effectsPanel.locator('input[type=file]').setInputFiles(wavPath)
      await expect(effectsPanel.locator('li').filter({ hasText: timestamp })).toBeVisible({ timeout: 15_000 })
      await expect(effectsPanel.getByText('Uploaded.')).toBeVisible({ timeout: 5000 })

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
      const musicPanel = page.locator('section.panel').filter({ hasText: 'Music' })
      await musicPanel.locator('input[type=file]').setInputFiles(wavPath)
      const listItem = musicPanel.locator('li').filter({ hasText: timestamp })
      await expect(listItem).toBeVisible({ timeout: 15_000 })

      // Click the × delete button, then confirm with "Delete"
      await listItem.locator('.btn-delete').click()
      await listItem.locator('.btn-confirm-delete').click()
      await expect(musicPanel.getByText('Deleted.')).toBeVisible({ timeout: 5000 })

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
      const effectsPanel = page.locator('section.panel').filter({ hasText: 'Effects' })
      await effectsPanel.locator('input[type=file]').setInputFiles(wavPath)
      const listItem = effectsPanel.locator('li').filter({ hasText: timestamp })
      await expect(listItem).toBeVisible({ timeout: 15_000 })

      // Click the × delete button, then confirm with "Delete"
      await listItem.locator('.btn-delete').click()
      await listItem.locator('.btn-confirm-delete').click()
      await expect(effectsPanel.getByText('Deleted.')).toBeVisible({ timeout: 5000 })

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
