import { unlinkSync, existsSync } from 'node:fs'
import { expect } from '@playwright/test'
import { test } from '@playwright/test'
import { createMinimalWavPath } from '../fixtures/minimal-wav.js'
import {
  createSidecarClient,
  destroySidecarClient,
  sendCommandAndGetReply,
} from '../sidecar-helper.js'
import type { Client } from 'discord.js'
import { e2eEnv, isE2eConfigured, isSidecarConfigured } from '../setup.js'

// VoiceChannel type for member check
type VoiceChannel = import('discord.js').VoiceChannel

const { baseUrl, guildId, voiceChannelId, textChannelId, commandPrefix } = e2eEnv
const api = (path: string) => `${baseUrl}/api${path}`

async function get<T>(path: string): Promise<T> {
  const res = await fetch(api(path))
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

/** Send command and get reply, retrying when reply indicates list failure (transient). */
async function sendCommandAndGetReplyWithRetry(
  sidecar: Client,
  textChannelId: string,
  hibikiUserId: string,
  command: string,
  maxAttempts = 3,
): Promise<string> {
  let lastReply = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastReply = await sendCommandAndGetReply(sidecar, textChannelId, hibikiUserId, command)
    if (!lastReply.toLowerCase().includes('failed to list'))
      return lastReply
    if (attempt < maxAttempts)
      await new Promise(r => setTimeout(r, 3000))
  }
  return lastReply
}

test.describe('Hibiki web E2E (localhost:3000 + optional sidecar)', () => {
  let sidecar: Client | null = null
  let hibikiUserId: string | null = null

  test.beforeAll(async () => {
    if (!isSidecarConfigured()) return
    sidecar = await createSidecarClient()
    if (!sidecar) return
    try {
      const status = await get<{ ready: boolean; userId?: string }>('/player/bot-status')
      if (status.ready && status.userId) hibikiUserId = status.userId
    } catch {
      // API unreachable
    }
  })

  test.afterAll(() => {
    destroySidecarClient(sidecar)
  })

  test('web loads Control Center', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Control Center' })).toBeVisible()
  })

  test('web loads Media Management', async ({ page }) => {
    await page.goto('/media')
    await expect(page.getByRole('heading', { name: 'Media Management' })).toBeVisible()
    await expect(page.locator('section.sound-panel').filter({ hasText: 'Music' })).toBeVisible()
    await expect(page.locator('section.sound-panel').filter({ hasText: 'Effects' })).toBeVisible()
  })

  test('web join voice channel', async ({ page }) => {
    if (!isE2eConfigured()) test.skip()

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Control Center' })).toBeVisible()

    await page.getByLabel('Guild').selectOption({ value: guildId })
    await page.getByLabel('Channel').selectOption({ value: voiceChannelId })
    await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible({ timeout: 15_000 })

    if (sidecar && hibikiUserId && voiceChannelId) {
      const guild = await sidecar!.guilds.fetch(guildId)
      const channel = (await guild.channels.fetch(voiceChannelId)) as VoiceChannel
      expect(channel.members.has(hibikiUserId)).toBe(true)
    }
  })

  test('web leave voice channel', async ({ page }) => {
    if (!isE2eConfigured()) test.skip()

    await page.goto('/')
    await page.getByLabel('Guild').selectOption({ value: guildId })
    await page.getByLabel('Channel').selectOption({ value: voiceChannelId })
    await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Leave' }).click()
    await expect(page.getByRole('button', { name: 'Leave' })).not.toBeVisible({ timeout: 5000 })

    if (sidecar && hibikiUserId && voiceChannelId) {
      await page.waitForTimeout(1500)
      const guild = await sidecar!.guilds.fetch(guildId)
      const channel = (await guild.channels.fetch(voiceChannelId)) as VoiceChannel
      expect(channel.members.has(hibikiUserId)).toBe(false)
    }
  })

  test('web play track and trigger effect', async ({ page }) => {
    if (!isE2eConfigured()) test.skip()

    await page.goto('/')
    await page.getByLabel('Guild').selectOption({ value: guildId })
    await page.getByLabel('Channel').selectOption({ value: voiceChannelId })
    await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible({ timeout: 15_000 })

    const music = await get<Array<{ id: string; name: string }>>('/sounds/music')
    const effects = await get<Array<{ id: string; name: string }>>('/sounds/effects')

    if (music.length > 0) {
      const trackRow = page.locator('.row-actions').filter({ has: page.getByRole('button', { name: 'Play' }).first() })
      const trackControl = trackRow.locator('select, [role="combobox"]').first()
      const trackTag = await trackControl.evaluate(el => (el as HTMLElement).tagName)
      if (trackTag === 'SELECT') {
        await trackControl.selectOption({ value: music[0].id })
      }
      else {
        await trackControl.click()
        await trackControl.fill(music[0].name)
        await page.getByRole('option', { name: music[0].name }).first().click()
      }
      await page.getByRole('button', { name: 'Play' }).first().click()
      await expect(page.getByRole('alert').filter({ hasText: /playing|done/i })).toBeVisible({ timeout: 10_000 })
    }

    if (effects.length > 0) {
      const effectRow = page.locator('.row-actions').filter({ has: page.getByRole('button', { name: 'Play effect' }) })
      const effectControl = effectRow.locator('select, [role="combobox"]').first()
      const effectTag = await effectControl.evaluate(el => (el as HTMLElement).tagName)
      if (effectTag === 'SELECT') {
        await effectControl.selectOption({ value: effects[0].id })
      }
      else {
        await effectControl.click()
        await effectControl.fill(effects[0].name)
        await page.getByRole('option', { name: effects[0].name }).first().click()
      }
      await page.getByRole('button', { name: 'Play effect' }).click()
      await expect(page.getByRole('alert').filter({ hasText: /effect|done/i })).toBeVisible({ timeout: 10_000 })
    }
  })

  test('upload song on web, sidecar !songs shows it', async ({ page }) => {
    if (!isSidecarConfigured() || !textChannelId || !hibikiUserId || !sidecar) test.skip()

    const timestamp = String(Date.now())
    const unique = `e2e-upload-song-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('/media')
      const musicPanel = page.locator('section.sound-panel').filter({ hasText: 'Music' })
      await musicPanel.locator('input[type=file]').setInputFiles(wavPath)
      // Backend humanizes filename: "e2e-upload-song-123" -> "E2e Upload Song 123"; match by timestamp
      await expect(musicPanel.locator('li').filter({ hasText: timestamp })).toBeVisible({ timeout: 15_000 })
      await expect(musicPanel.getByText('Uploaded.')).toBeVisible({ timeout: 5000 })
      await page.waitForTimeout(2000)

      const reply = await sendCommandAndGetReplyWithRetry(
        sidecar!,
        textChannelId,
        hibikiUserId!,
        `${commandPrefix}songs`,
      )
      expect(reply.toLowerCase()).toMatch(new RegExp(unique, 'i'))
      expect(reply.toLowerCase()).toMatch(/songs|music/)
    } finally {
      if (existsSync(wavPath)) unlinkSync(wavPath)
    }
  })

  test('upload effect on web, sidecar !effects shows it', async ({ page }) => {
    if (!isSidecarConfigured() || !textChannelId || !hibikiUserId || !sidecar) test.skip()

    const timestamp = String(Date.now())
    const unique = `e2e-upload-effect-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('/media')
      const effectsPanel = page.locator('section.sound-panel').filter({ hasText: 'Effects' })
      await effectsPanel.locator('input[type=file]').setInputFiles(wavPath)
      await expect(effectsPanel.locator('li').filter({ hasText: timestamp })).toBeVisible({ timeout: 15_000 })
      await expect(effectsPanel.getByText('Uploaded.')).toBeVisible({ timeout: 5000 })
      await page.waitForTimeout(2000)

      const reply = await sendCommandAndGetReplyWithRetry(
        sidecar!,
        textChannelId,
        hibikiUserId!,
        `${commandPrefix}effects`,
      )
      expect(reply.toLowerCase()).toMatch(new RegExp(unique, 'i'))
      expect(reply.toLowerCase()).toMatch(/effects/)
    } finally {
      if (existsSync(wavPath)) unlinkSync(wavPath)
    }
  })

  test('delete song on web, sidecar !songs does not show it', async ({ page }) => {
    if (!isSidecarConfigured() || !textChannelId || !hibikiUserId || !sidecar) test.skip()

    const timestamp = String(Date.now())
    const unique = `e2e-delete-song-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('/media')
      const musicPanel = page.locator('section.sound-panel').filter({ hasText: 'Music' })
      await musicPanel.locator('input[type=file]').setInputFiles(wavPath)
      const listItem = musicPanel.locator('li').filter({ hasText: timestamp })
      await expect(listItem).toBeVisible({ timeout: 15_000 })

      await listItem.getByRole('button', { name: 'Delete' }).click()
      await musicPanel.getByRole('button', { name: 'Yes' }).click()
      await expect(musicPanel.getByText('Deleted.')).toBeVisible({ timeout: 5000 })

      const reply = await sendCommandAndGetReply(
        sidecar!,
        textChannelId,
        hibikiUserId!,
        `${commandPrefix}songs`,
      )
      expect(reply.toLowerCase()).not.toMatch(new RegExp(unique, 'i'))
    } finally {
      if (existsSync(wavPath)) unlinkSync(wavPath)
    }
  })

  test('delete effect on web, sidecar !effects does not show it', async ({ page }) => {
    if (!isSidecarConfigured() || !textChannelId || !hibikiUserId || !sidecar) test.skip()

    const timestamp = String(Date.now())
    const unique = `e2e-delete-effect-${timestamp}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('/media')
      const effectsPanel = page.locator('section.sound-panel').filter({ hasText: 'Effects' })
      await effectsPanel.locator('input[type=file]').setInputFiles(wavPath)
      const listItem = effectsPanel.locator('li').filter({ hasText: timestamp })
      await expect(listItem).toBeVisible({ timeout: 15_000 })

      await listItem.getByRole('button', { name: 'Delete' }).click()
      await effectsPanel.getByRole('button', { name: 'Yes' }).click()
      await expect(effectsPanel.getByText('Deleted.')).toBeVisible({ timeout: 5000 })

      const reply = await sendCommandAndGetReply(
        sidecar!,
        textChannelId,
        hibikiUserId!,
        `${commandPrefix}effects`,
      )
      expect(reply.toLowerCase()).not.toMatch(new RegExp(unique, 'i'))
    } finally {
      if (existsSync(wavPath)) unlinkSync(wavPath)
    }
  })
})
