import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client, Events, GatewayIntentBits, type TextChannel, type VoiceChannel } from 'discord.js'
import { joinVoiceChannel } from '@discordjs/voice'
import { e2eEnv, isE2eConfigured, isSidecarConfigured } from './setup.js'

const { baseUrl, guildId, voiceChannelId, textChannelId, sidecarToken, commandPrefix } = e2eEnv
const api = (path: string) => `${baseUrl}/api${path}`

function isServerUnreachable(err: unknown): boolean {
  const check = (e: unknown): boolean => {
    if (!e || typeof e !== 'object') return false
    const o = e as { code?: string; errors?: Array<{ code?: string }> }
    if (o.code === 'ECONNREFUSED' || o.code === 'EPERM') return true
    if (Array.isArray(o.errors)) return o.errors.some((x: { code?: string }) => x.code === 'ECONNREFUSED' || x.code === 'EPERM')
    return false
  }
  return check(err) || check((err as { cause?: unknown })?.cause)
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(api(path))
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function post(path: string, body: object): Promise<unknown> {
  const res = await fetch(api(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${await res.text()}`)
  return res.json()
}

describe('Hibiki sidecar E2E (Discord voice state + optional text)', () => {
  let sidecar: Client | null = null

  beforeAll(async function () {
    if (!isSidecarConfigured() || !isE2eConfigured()) {
      console.warn('Sidecar E2E skipped: set E2E_SIDECAR_TOKEN, E2E_GUILD_ID, E2E_VOICE_CHANNEL_ID')
      return
    }
    try {
      sidecar = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildVoiceStates,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
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
    } catch {
      sidecar = null
    }
  })

  afterAll(async () => {
    if (sidecar) {
      sidecar.destroy()
    }
  })

  it('after Hibiki joins, sidecar sees bot in voice channel', async function () {
    if (!sidecar || !isE2eConfigured() || !isSidecarConfigured()) return

    let status: { ready: boolean; userId?: string }
    try {
      status = await get<{ ready: boolean; userId?: string }>('/player/bot-status')
    } catch (err: unknown) {
      if (isServerUnreachable(err)) return // Hibiki API not running or unreachable
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
    const membersAfter = (channelAfter as import('discord.js').VoiceChannel)?.members ?? new Map()
    expect(membersAfter.has(hibikiUserId!)).toBe(false)
  })

  /** Send a command in the text channel and return Hibiki's reply content (or throw on timeout).
   *  Note: Discord does NOT deliver messages from one bot to another (messageCreate never fires).
   *  So these command tests only work when a human sends the message; they are skipped in automation. */
  async function sendCommandAndGetReply(
    hibikiUserId: string,
    command: string,
    timeoutMs = 12_000,
  ): Promise<string> {
    if (!sidecar || !textChannelId) throw new Error('Sidecar or text channel not configured')
    const channel = (await sidecar.channels.fetch(textChannelId)) as TextChannel
    const ourMessage = await channel.send({ content: command })
    const reply = await new Promise<string>((resolve, reject) => {
      const collector = channel.createMessageCollector({
        filter: (m) =>
          m.author.id === hibikiUserId && m.reference?.messageId === ourMessage.id,
        max: 1,
        time: timeoutMs,
      })
      collector.on('collect', (m) => resolve(m.content))
      collector.on('end', (collected) => {
        if (collected.size === 0) reject(new Error(`No reply from Hibiki to "${command}" within ${timeoutMs}ms`))
      })
    })
    return reply
  }

  // When Hibiki is started with HIBIKI_E2E_ALLOW_BOT_ID set to the sidecar's Discord user ID, it will
  // process prefix commands from that bot so these tests can run. Set HIBIKI_E2E_ALLOW_BOT_ID in the
  // Hibiki process (e.g. in .env or docker-compose) to the sidecar bot's user ID.
  it('sidecar sends !join in text channel and Hibiki replies and joins voice', async function () {
    if (!sidecar || !textChannelId || !isE2eConfigured() || !isSidecarConfigured()) return

    let hibikiUserId: string
    try {
      const status = await get<{ ready: boolean; userId?: string }>('/player/bot-status')
      if (!status.ready || !status.userId) throw new Error('Hibiki not ready')
      hibikiUserId = status.userId
    } catch (err: unknown) {
      if (isServerUnreachable(err)) return
      throw err
    }

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
      const reply = await sendCommandAndGetReply(hibikiUserId, `${commandPrefix}join`)
      expect(reply).toMatch(/connected/i)

      const members = voiceChannel.members
      expect(members.has(hibikiUserId)).toBe(true)
    } finally {
      connection.destroy()
    }
  })

  it('sidecar sends !leave in text channel and Hibiki replies and leaves voice', async function () {
    if (!sidecar || !textChannelId || !isE2eConfigured() || !isSidecarConfigured()) return

    let hibikiUserId: string
    try {
      const status = await get<{ ready: boolean; userId?: string }>('/player/bot-status')
      if (!status.ready || !status.userId) throw new Error('Hibiki not ready')
      hibikiUserId = status.userId
    } catch (err: unknown) {
      if (isServerUnreachable(err)) return
      throw err
    }

    await post('/player/join', { guildId, channelId: voiceChannelId })
    await new Promise(r => setTimeout(r, 500))

    const reply = await sendCommandAndGetReply(hibikiUserId, `${commandPrefix}leave`)
    expect(reply).toMatch(/disconnected/i)

    await new Promise(r => setTimeout(r, 1500))
    const guild = await sidecar.guilds.fetch(guildId)
    const channelAfter = (await guild.channels.fetch(voiceChannelId)) as VoiceChannel
    expect(channelAfter.members.has(hibikiUserId)).toBe(false)
  })

  it('sidecar sends !songs and Hibiki replies with list or message', async function () {
    if (!sidecar || !textChannelId || !isSidecarConfigured()) return

    let hibikiUserId: string
    try {
      const status = await get<{ ready: boolean; userId?: string }>('/player/bot-status')
      if (!status.ready || !status.userId) throw new Error('Hibiki not ready')
      hibikiUserId = status.userId
    } catch (err: unknown) {
      if (isServerUnreachable(err)) return
      throw err
    }

    const reply = await sendCommandAndGetReply(hibikiUserId, `${commandPrefix}songs`)
    expect(reply.length).toBeGreaterThan(0)
    expect(reply.toLowerCase()).toMatch(/songs|no songs|music|upload/)
  })

  it('sidecar sends !effects and Hibiki replies with list or message', async function () {
    if (!sidecar || !textChannelId || !isSidecarConfigured()) return
    let hibikiUserId: string
    try {
      const status = await get<{ ready: boolean; userId?: string }>('/player/bot-status')
      if (!status.ready || !status.userId) throw new Error('Hibiki not ready')
      hibikiUserId = status.userId
    } catch (err: unknown) {
      if (isServerUnreachable(err)) return
      throw err
    }

    const reply = await sendCommandAndGetReply(hibikiUserId, `${commandPrefix}effects`)
    expect(reply.length).toBeGreaterThan(0)
    expect(reply.toLowerCase()).toMatch(/effects|no effects|upload/)
  })

  it('sidecar sends !panel and Hibiki replies with control panel message', async function () {
    if (!sidecar || !textChannelId || !isSidecarConfigured()) return

    let hibikiUserId: string
    try {
      const status = await get<{ ready: boolean; userId?: string }>('/player/bot-status')
      if (!status.ready || !status.userId) throw new Error('Hibiki not ready')
      hibikiUserId = status.userId
    } catch (err: unknown) {
      if (isServerUnreachable(err)) return
      throw err
    }

    const reply = await sendCommandAndGetReply(hibikiUserId, `${commandPrefix}panel`)
    expect(reply.toLowerCase()).toContain('control panel')
  })

  it('full command flow via text: !join, !play 1, !effect 1, !leave', async function () {
    if (!sidecar || !textChannelId || !isE2eConfigured() || !isSidecarConfigured()) return

    let hibikiUserId: string
    try {
      const status = await get<{ ready: boolean; userId?: string }>('/player/bot-status')
      if (!status.ready || !status.userId) throw new Error('Hibiki not ready')
      hibikiUserId = status.userId
    } catch (err: unknown) {
      if (isServerUnreachable(err)) return
      throw err
    }

    const [music, effects] = await Promise.all([
      get<Array<{ id: string; name: string }>>('/sounds/music'),
      get<Array<{ id: string; name: string }>>('/sounds/effects'),
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
      const joinReply = await sendCommandAndGetReply(hibikiUserId, `${commandPrefix}join`)
      expect(joinReply).toMatch(/connected/i)
      expect(voiceChannel.members.has(hibikiUserId)).toBe(true)

      if (firstTrackId) {
        const playReply = await sendCommandAndGetReply(hibikiUserId, `${commandPrefix}play ${firstTrackId}`, 15_000)
        expect(playReply).toMatch(/playing|now playing/i)
      }

      if (firstEffectId) {
        const effectReply = await sendCommandAndGetReply(hibikiUserId, `${commandPrefix}effect ${firstEffectId}`, 10_000)
        expect(effectReply).toMatch(/triggered|playing|effect/i)
      }

      const leaveReply = await sendCommandAndGetReply(hibikiUserId, `${commandPrefix}leave`)
      expect(leaveReply).toMatch(/disconnected/i)

      await new Promise(r => setTimeout(r, 1500))
      const channelAfter = (await guild.channels.fetch(voiceChannelId)) as VoiceChannel
      expect(channelAfter.members.has(hibikiUserId)).toBe(false)
    } finally {
      connection.destroy()
    }
  })
})
