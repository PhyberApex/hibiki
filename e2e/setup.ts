import { resolve } from 'node:path'
import { config } from 'dotenv'

// Load E2E env from repo root so one .env.e2e works for bot + e2e
config({ path: resolve(process.cwd(), '.env.e2e') })
config({ path: resolve(process.cwd(), '../.env.e2e') })

const baseUrl = process.env.E2E_HIBIKI_API_URL ?? 'http://localhost:3000'
const guildId = process.env.E2E_GUILD_ID
const voiceChannelId = process.env.E2E_VOICE_CHANNEL_ID
/** Hibiki command prefix (must match bot HIBIKI_PREFIX when set). E2E uses prefix to drive commands. */
const commandPrefix = process.env.E2E_HIBIKI_PREFIX ?? '!'

export const e2eEnv = {
  baseUrl: baseUrl.replace(/\/$/, ''),
  guildId: guildId ?? '',
  voiceChannelId: voiceChannelId ?? '',
  textChannelId: process.env.E2E_TEXT_CHANNEL_ID ?? '',
  sidecarToken: process.env.E2E_SIDECAR_TOKEN ?? '',
  commandPrefix,
}

export function isE2eConfigured(): boolean {
  return Boolean(e2eEnv.guildId && e2eEnv.voiceChannelId)
}

export function isSidecarConfigured(): boolean {
  return Boolean(e2eEnv.sidecarToken)
}
