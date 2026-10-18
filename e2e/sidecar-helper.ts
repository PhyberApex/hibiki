import type { VoiceConnection } from '@discordjs/voice'
import type { Page } from '@playwright/test'
import type { Client } from 'discord.js'
import {
  EndBehaviorType,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from '@discordjs/voice'
import { Client as DiscordClient, Events, GatewayIntentBits } from 'discord.js'
import { invokeApi } from './electron-test-utils.js'
import { e2eEnv, isSidecarConfigured } from './setup.js'

/**
 * The sidecar is a second bot that observes the test server from the outside:
 * it checks Hibiki's voice state and, for playback tests, joins the same voice
 * channel to receive what Hibiki sends. It never plays anything itself.
 */
export async function createSidecarClient(): Promise<Client | null> {
  if (!isSidecarConfigured())
    return null
  const { sidecarToken } = e2eEnv
  const client = new DiscordClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  })
  await client.login(sidecarToken)
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Sidecar login timeout')), 25_000)
    client.once(Events.ClientReady, () => {
      clearTimeout(t)
      resolve()
    })
  })
  return client
}

export function destroySidecarClient(client: Client | null): void {
  if (client)
    client.destroy()
}

/** Polls Hibiki's bot status over IPC until the Discord client is logged in. */
export async function waitForHibikiUserId(page: Page, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastStatus: unknown
  while (Date.now() < deadline) {
    try {
      const status = await invokeApi<{ ready: boolean, userId?: string }>(page, 'player', 'getBotStatus')
      lastStatus = status
      if (status.ready && status.userId)
        return status.userId
    }
    catch (err) {
      lastStatus = (err as Error).message
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`Hibiki bot not ready within ${timeoutMs}ms (last status: ${JSON.stringify(lastStatus)})`)
}

/** The voice channel id the sidecar currently sees `userId` in, or null when not in voice. */
export async function voiceChannelOf(sidecar: Client, guildId: string, userId: string): Promise<string | null> {
  const guild = await sidecar.guilds.fetch(guildId)
  const member = await guild.members.fetch({ user: userId, force: true })
  return member.voice.channelId ?? guild.voiceStates.cache.get(userId)?.channelId ?? null
}

/** The Opus frame `@discordjs/voice` sends in place of audio when its resource yields nothing. */
const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE])

export interface AudioCapture {
  /** Resolves once Discord reports the user as speaking. */
  speaking: Promise<void>
  /** Number of Opus packets received from the user so far. */
  packetCount: () => number
  /** Whether Discord currently reports the user as speaking (a packet within the last 100 ms). */
  isSpeaking: () => boolean
  /** How many of those packets were the 3-byte Opus silence frame the voice player sends when it has nothing to play. */
  silenceFrameCount: () => number
  /** Leaves the voice channel and stops counting. */
  stop: () => void
}

/** Joins `channelId` with the sidecar and counts the voice packets `userId` sends. */
export async function captureAudioFrom(
  sidecar: Client,
  guildId: string,
  channelId: string,
  userId: string,
): Promise<AudioCapture> {
  const guild = await sidecar.guilds.fetch(guildId)
  const connection: VoiceConnection = joinVoiceChannel({
    guildId,
    channelId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  })
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000)
  }
  catch (err) {
    connection.destroy()
    throw new Error(`Sidecar voice connection never became ready: ${(err as Error).message}`)
  }

  const receiver = connection.receiver
  const speaking = new Promise<void>((resolve) => {
    if (receiver.speaking.users.has(userId)) {
      resolve()
      return
    }
    const onStart = (speakingUserId: string) => {
      if (speakingUserId !== userId)
        return
      receiver.speaking.off('start', onStart)
      resolve()
    }
    receiver.speaking.on('start', onStart)
  })

  let packets = 0
  let silenceFrames = 0
  const opus = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } })
  opus.on('data', (packet: Buffer) => {
    packets += 1
    if (packet.equals(SILENCE_FRAME))
      silenceFrames += 1
  })
  opus.on('error', (err) => {
    console.warn('[sidecar] opus receive stream error:', err.message)
  })

  return {
    speaking,
    packetCount: () => packets,
    isSpeaking: () => receiver.speaking.users.has(userId),
    silenceFrameCount: () => silenceFrames,
    stop: () => {
      opus.destroy()
      connection.destroy()
    },
  }
}
