import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeElectronApp, getMainWindow, invokeApi, launchElectronApp } from '../electron-test-utils.js'
import { e2eEnv } from '../setup.js'

/**
 * The Discord token lifecycle: Remove in Settings takes the bot offline, drops
 * the key from app-config.json and falls back to the Local Target; pasting the
 * token again brings the bot and its guild list back. Runs against a throwaway
 * profile seeded with the token, so the shared profile's token is never touched.
 */

const token = process.env.DISCORD_TOKEN ?? ''

let userDataDir: string
let app: ElectronApplication | undefined
let page: Page

function configPath(): string {
  return join(userDataDir, 'data', 'app-config.json')
}

function storedConfig(): Record<string, string> {
  return JSON.parse(readFileSync(configPath(), 'utf8'))
}

async function botReady(): Promise<boolean> {
  return (await invokeApi<{ ready: boolean }>(page, 'player', 'getBotStatus')).ready
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.skip(!token, 'DISCORD_TOKEN is not set')
  userDataDir = mkdtempSync(join(tmpdir(), 'hibiki-e2e-token-'))
  mkdirSync(join(userDataDir, 'data'), { recursive: true })
  // Seeded in plaintext; the app migrates it to encrypted storage on read when it can.
  writeFileSync(configPath(), JSON.stringify({
    'discord.token': token,
    'updates': JSON.stringify({ enabled: false }),
  }))
  app = await launchElectronApp({
    // Pinned to empty so only the stored token configures the bot and Remove can take it away.
    env: {
      DISCORD_TOKEN: '',
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

test('Remove clears the token, takes the bot offline and makes Local active', async () => {
  await expect.poll(botReady, { timeout: 30_000 }).toBe(true)
  await invokeApi(page, 'config', 'setActiveOutputTarget', ['discord'])
  expect(await invokeApi(page, 'config', 'getActiveOutputTarget')).toBe('discord')

  await page.goto('hibiki://app/settings')
  await expect(page.getByText('Connected as')).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('discord-token-remove').click()

  await expect(page.getByText('Token removed.')).toBeVisible()
  await expect(page.getByText('No token — optional')).toBeVisible()
  await expect(page.getByTestId('discord-token-remove')).toHaveCount(0)
  await expect.poll(botReady).toBe(false)
  expect('discord.token' in storedConfig()).toBe(false)
  expect(await invokeApi(page, 'config', 'getActiveOutputTarget')).toBe('local')
  expect(await invokeApi(page, 'config', 'getDiscord')).toMatchObject({ tokenConfigured: false })
})

test('setting the token again reconnects the bot and the guild list reappears', async () => {
  await page.goto('hibiki://app/settings')
  await page.getByLabel('Bot token').fill(token)
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect.poll(botReady, { timeout: 30_000 }).toBe(true)
  await expect(page.getByText('Connected as')).toBeVisible({ timeout: 30_000 })
  expect('discord.token' in storedConfig()).toBe(true)
  await expect.poll(async () => (await invokeApi<{ guildId: string }[]>(page, 'player', 'getGuildDirectory')).length, { timeout: 15_000 }).toBeGreaterThan(0)
  if (e2eEnv.guildId) {
    const directory = await invokeApi<{ guildId: string }[]>(page, 'player', 'getGuildDirectory')
    expect(directory.map(g => g.guildId)).toContain(e2eEnv.guildId)
  }
})
