import type { VoiceBasedChannel } from 'discord.js'
import type { Config } from '../config'
import { Client, Events, GatewayIntentBits } from 'discord.js'
import { createLogger } from '../logger'

const READY_TIMEOUT_MS = 15_000

const log = createLogger('discord')

export interface AppConfig {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
}

export interface GuildDirectoryEntry {
  guildId: string
  guildName: string
  iconUrl: string | null
  channels: { id: string, name: string }[]
}

const CLIENT_OPTIONS = {
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
} as const

export function createDiscordClient(config: Config, appConfig: AppConfig) {
  let client = new Client(CLIENT_OPTIONS)

  async function login(): Promise<void> {
    let token = config.discord.token
    if (!token) {
      const fromDb = await appConfig.get('discord.token')
      token = fromDb ?? ''
    }
    if (!token) {
      log.warn('No token configured — skipping login')
      return
    }
    log.info('Logging in…')

    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Discord client ready timeout')), READY_TIMEOUT_MS)
      const onReady = () => {
        clearTimeout(timeout)
        client.off(Events.ClientReady, onReady)
        resolve()
      }
      client.on(Events.ClientReady, onReady)
    })

    await client.login(token)
    if (!client.isReady())
      await readyPromise

    log.info('Login complete')
  }

  async function destroy(): Promise<void> {
    if (client.isReady()) {
      log.info('Destroying client')
      await client.destroy()
    }
  }

  async function reconnect(): Promise<void> {
    log.info('Reconnecting…')
    await destroy()
    client = new Client(CLIENT_OPTIONS)
    await login()
  }

  function getClient(): Client {
    return client
  }

  async function leaveVoiceChannel(guildId: string): Promise<boolean> {
    if (!client.isReady())
      return false
    const guild = client.guilds.cache.get(guildId)
    if (!guild)
      return false
    const me = guild.members.me
    const voice = me?.voice
    if (!voice?.channelId)
      return false
    try {
      await voice.setChannel(null)
      return true
    }
    catch {
      return false
    }
  }

  function getBotVoiceStateForGuild(guildId: string): { channelId: string | null, channelName: string | null } {
    if (!client.isReady())
      return { channelId: null, channelName: null }
    const guild = client.guilds.cache.get(guildId)
    const voice = guild?.members.me?.voice
    const channelId = voice?.channelId ?? voice?.channel?.id ?? null
    const channelName = voice?.channel?.name ?? null
    return { channelId, channelName }
  }

  function getBotStatus(): { ready: boolean, userTag?: string, userId?: string } {
    if (!client.isReady())
      return { ready: false }
    return {
      ready: true,
      userTag: client.user?.tag,
      userId: client.user?.id,
    }
  }

  function listGuildDirectory(): GuildDirectoryEntry[] {
    if (!client.isReady())
      return []
    return client.guilds.cache.map(guild => ({
      guildId: guild.id,
      guildName: guild.name,
      iconUrl: guild.iconURL({ size: 32 }),
      channels: guild.channels.cache
        .filter((ch): ch is VoiceBasedChannel => ch.isVoiceBased())
        .map(ch => ({ id: ch.id, name: ch.name ?? ch.id })),
    }))
  }

  return {
    login,
    destroy,
    reconnect,
    getClient,
    leaveVoiceChannel,
    getBotVoiceStateForGuild,
    getBotStatus,
    listGuildDirectory,
  }
}

export type DiscordClient = ReturnType<typeof createDiscordClient>
