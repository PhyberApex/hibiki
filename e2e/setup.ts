import { resolve } from 'node:path'
import { config } from 'dotenv'

// Load E2E env from repo root so one .env.e2e works for the entire project
config({ path: resolve(process.cwd(), '.env.e2e') })
config({ path: resolve(process.cwd(), '../.env.e2e') })

const guildId = process.env.E2E_GUILD_ID
const voiceChannelId = process.env.E2E_VOICE_CHANNEL_ID
const sidecarToken = process.env.E2E_SIDECAR_TOKEN

export const e2eEnv = {
  guildId: guildId ?? '',
  voiceChannelId: voiceChannelId ?? '',
  sidecarToken: sidecarToken ?? '',
}

export function isE2eConfigured(): boolean {
  return Boolean(e2eEnv.guildId && e2eEnv.voiceChannelId)
}

export function isSidecarConfigured(): boolean {
  return Boolean(e2eEnv.sidecarToken)
}
