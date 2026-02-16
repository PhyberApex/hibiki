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
      await page.getByLabel('Track').selectOption({ value: music[0].id })
      await page.getByRole('button', { name: 'Play' }).first().click()
      await expect(page.getByRole('alert').filter({ hasText: /playing|done/i })).toBeVisible({ timeout: 10_000 })
    }

    if (effects.length > 0) {
      await page.getByRole('combobox', { name: 'Effect' }).selectOption({ value: effects[0].id })
      await page.getByRole('button', { name: 'Play effect' }).click()
      await expect(page.getByRole('alert').filter({ hasText: /effect|done/i })).toBeVisible({ timeout: 10_000 })
    }
  })

  test('upload song on web, sidecar !songs shows it', async ({ page }) => {
    if (!isSidecarConfigured() || !textChannelId || !hibikiUserId || !sidecar) test.skip()

    const unique = `e2e-upload-song-${Date.now()}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('/')
      const musicPanel = page.locator('section.sound-panel').filter({ hasText: 'Music' })
      await musicPanel.locator('input[type=file]').setInputFiles(wavPath)
      await expect(musicPanel.locator('li').filter({ hasText: unique })).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(1000)

      const reply = await sendCommandAndGetReply(
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

    const unique = `e2e-upload-effect-${Date.now()}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('/')
      const effectsPanel = page.locator('section.sound-panel').filter({ hasText: 'Effects' })
      await effectsPanel.locator('input[type=file]').setInputFiles(wavPath)
      await expect(effectsPanel.locator('li').filter({ hasText: unique })).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(1000)

      const reply = await sendCommandAndGetReply(
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

    const unique = `e2e-delete-song-${Date.now()}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('/')
      const musicPanel = page.locator('section.sound-panel').filter({ hasText: 'Music' })
      await musicPanel.locator('input[type=file]').setInputFiles(wavPath)
      await expect(musicPanel.locator('li').filter({ hasText: unique })).toBeVisible({ timeout: 15_000 })

      await musicPanel.locator('li').filter({ hasText: unique }).getByRole('button', { name: 'Delete' }).click()
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

    const unique = `e2e-delete-effect-${Date.now()}`
    const wavPath = createMinimalWavPath(`${unique}.wav`)
    try {
      await page.goto('/')
      const effectsPanel = page.locator('section.sound-panel').filter({ hasText: 'Effects' })
      await effectsPanel.locator('input[type=file]').setInputFiles(wavPath)
      await expect(effectsPanel.locator('li').filter({ hasText: unique })).toBeVisible({ timeout: 15_000 })

      await effectsPanel.locator('li').filter({ hasText: unique }).getByRole('button', { name: 'Delete' }).click()
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
