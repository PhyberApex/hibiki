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

function attachClientLogging(client: Client): Client {
  client.on(Events.ClientReady, (ready) => {
    log.info(`Ready as ${ready.user.tag} in ${ready.guilds.cache.size} guild(s)`)
  })
  client.on(Events.Error, error => log.error('Client error:', error))
  client.on(Events.Warn, message => log.warn(message))
  client.on(Events.ShardDisconnect, (event, shardId) => log.warn(`Gateway disconnected (shard ${shardId}, code ${event.code})`))
  client.on(Events.ShardReconnecting, shardId => log.info(`Gateway reconnecting (shard ${shardId})`))
  client.on(Events.ShardResume, (shardId, replayed) => log.info(`Gateway resumed (shard ${shardId}, ${replayed} events replayed)`))
  client.on(Events.Invalidated, () => log.error('Session invalidated by Discord; a reconnect is required'))
  return client
}

export function createDiscordClient(config: Config, appConfig: AppConfig) {
  let client = attachClientLogging(new Client(CLIENT_OPTIONS))

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
    // Pinned for the whole attempt: a reconnect or logout swaps `client` while
    // this login may still be pending, and its settling must not touch the new one.
    const attempt = client

    let timeout: ReturnType<typeof setTimeout> | undefined
    let onReady = () => {}
    const readyPromise = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Discord client ready timeout')), READY_TIMEOUT_MS)
      onReady = () => resolve()
      attempt.on(Events.ClientReady, onReady)
    })
    // The timer runs during `client.login` too, before anything awaits it: a
    // slow login that ends ready would otherwise leave this rejection unhandled.
    // Awaiting `readyPromise` below still sees the timeout.
    readyPromise.catch(() => {})

    try {
      await attempt.login(token)
      if (!attempt.isReady())
        await readyPromise
    }
    catch (err) {
      log.error('Login failed:', err)
      throw err
    }
    finally {
      // Also on a failed login, so neither the timer nor the listener outlives it.
      clearTimeout(timeout)
      attempt.off(Events.ClientReady, onReady)
    }

    log.info('Login complete')
  }

  function readiness(): string {
    return `client ${client.isReady()
      ? 'ready'
      : 'not ready'}`
  }

  /**
   * Destroys the client whether or not it is ready: a client whose login is
   * still in flight would otherwise come up later and stay connected for the
   * rest of the process (#651). discord.js's `destroy()` is safe on a client
   * that never logged in.
   */
  async function destroy(): Promise<void> {
    log.info(`Destroying client (${readiness()})`)
    await client.destroy()
  }

  /** Swaps in a fresh client first, then destroys the old one, ready or not. */
  async function replaceClient(): Promise<void> {
    const old = client
    client = attachClientLogging(new Client(CLIENT_OPTIONS))
    await old.destroy()
  }

  /**
   * Takes the bot offline even while a login is still in flight, leaving a
   * fresh client for the next `login`/`reconnect`.
   */
  async function logout(): Promise<void> {
    log.info(`Logging out (${readiness()})`)
    await replaceClient()
  }

  async function reconnect(): Promise<void> {
    log.info(`Reconnecting… (${readiness()})`)
    await replaceClient()
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
      log.info(`Left voice channel in guild ${guildId} via gateway`)
      return true
    }
    catch (err) {
      log.warn(`Could not leave voice channel in guild ${guildId}:`, err)
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
    logout,
    reconnect,
    getClient,
    leaveVoiceChannel,
    getBotVoiceStateForGuild,
    getBotStatus,
    listGuildDirectory,
  }
}

export type DiscordClient = ReturnType<typeof createDiscordClient>
