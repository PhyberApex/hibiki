import type { VoiceChannel } from 'discord.js'
import { joinVoiceChannel } from '@discordjs/voice'
import { Client, Events, GatewayIntentBits } from 'discord.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { e2eEnv, isE2eConfigured, isSidecarConfigured } from './setup.js'

const { baseUrl, guildId, voiceChannelId, sidecarToken } = e2eEnv
const api = (path: string) => `${baseUrl}/api${path}`

function isServerUnreachable(err: unknown): boolean {
  const check = (e: unknown): boolean => {
    if (!e || typeof e !== 'object')
      return false
    const o = e as { code?: string, errors?: Array<{ code?: string }> }
    if (o.code === 'ECONNREFUSED' || o.code === 'EPERM')
      return true
    if (Array.isArray(o.errors))
      return o.errors.some((x: { code?: string }) => x.code === 'ECONNREFUSED' || x.code === 'EPERM')
    return false
  }
  return check(err) || check((err as { cause?: unknown })?.cause)
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(api(path))
  if (!res.ok)
    throw new Error(`GET ${path} ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function post(path: string, body: object): Promise<unknown> {
  const res = await fetch(api(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok)
    throw new Error(`POST ${path} ${res.status}: ${await res.text()}`)
  return res.json()
}

describe('hibiki sidecar E2E (Discord voice state via API)', () => {
  let sidecar: Client | null = null

  beforeAll(async () => {
    if (!isSidecarConfigured() || !isE2eConfigured()) {
      console.warn('Sidecar E2E skipped: set E2E_SIDECAR_TOKEN, E2E_GUILD_ID, E2E_VOICE_CHANNEL_ID')
      return
    }
    try {
      sidecar = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildVoiceStates,
        ],
      })
      await sidecar.login(sidecarToken)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Sidecar login timeout')), 15_000)
        sidecar!.once(Events.ClientReady, () => {
          clearTimeout(t)
          resolve()
        })
      })
    }
    catch {
      sidecar = null
    }
  })

  afterAll(async () => {
    if (sidecar) {
      sidecar.destroy()
    }
  })

  it('after Hibiki joins via API, sidecar sees bot in voice channel', async () => {
    if (!sidecar || !isE2eConfigured() || !isSidecarConfigured())
      return

    let status: { ready: boolean, userId?: string }
    try {
      status = await get<{ ready: boolean, userId?: string }>('/player/bot-status')
    }
    catch (err: unknown) {
      if (isServerUnreachable(err))
        return // Hibiki API not running or unreachable
      throw err
    }
    expect(status.ready).toBe(true)
    const hibikiUserId = status.userId
    expect(hibikiUserId).toBeDefined()

    await post('/player/join', { guildId, channelId: voiceChannelId })

    const guild = await sidecar.guilds.fetch(guildId)
    const channel = await guild.channels.fetch(voiceChannelId)
    expect(channel?.isVoiceBased()).toBe(true)
    const voiceChannel = channel!
    const members = voiceChannel.members
    const hibikiInChannel = members.get(hibikiUserId!)
    expect(hibikiInChannel).toBeDefined()

    await post('/player/leave', { guildId })
    await new Promise(r => setTimeout(r, 1500))
    const channelAfter = await guild.channels.fetch(voiceChannelId)
    const membersAfter = (channelAfter as VoiceChannel)?.members ?? new Map()
    expect(membersAfter.has(hibikiUserId!)).toBe(false)
  })

  it('full flow via API: join, play, effect, leave; sidecar verifies voice state', async () => {
    if (!sidecar || !isE2eConfigured() || !isSidecarConfigured())
      return

    let hibikiUserId: string
    try {
      const status = await get<{ ready: boolean, userId?: string }>('/player/bot-status')
      if (!status.ready || !status.userId)
        throw new Error('Hibiki not ready')
      hibikiUserId = status.userId
    }
    catch (err: unknown) {
      if (isServerUnreachable(err))
        return
      throw err
    }

    const [music, effects] = await Promise.all([
      get<Array<{ id: string, name: string }>>('/sounds/music'),
      get<Array<{ id: string, name: string }>>('/sounds/effects'),
    ])
    const firstTrackId = music.length ? music[0].id : null
    const firstEffectId = effects.length ? effects[0].id : null

    const guild = await sidecar.guilds.fetch(guildId)
    const voiceChannel = (await guild.channels.fetch(voiceChannelId)) as VoiceChannel
    expect(voiceChannel?.isVoiceBased()).toBe(true)

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    })
    try {
      await post('/player/join', { guildId, channelId: voiceChannelId })
      await new Promise(r => setTimeout(r, 1500))
      expect(voiceChannel.members.has(hibikiUserId)).toBe(true)

      if (firstTrackId) {
        await post('/player/play', { guildId, trackId: firstTrackId, channelId: voiceChannelId })
      }
      if (firstEffectId) {
        await post('/player/effect', { guildId, effectId: firstEffectId, channelId: voiceChannelId })
      }

      await post('/player/leave', { guildId })
      await new Promise(r => setTimeout(r, 1500))
      const channelAfter = (await guild.channels.fetch(voiceChannelId)) as VoiceChannel
      expect(channelAfter.members.has(hibikiUserId)).toBe(false)
    }
    finally {
      connection.destroy()
    }
  })
})
