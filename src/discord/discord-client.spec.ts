import type { EventEmitter } from 'node:events'
import type { Config } from '../config'
import type { AppConfig } from './discord-client'
import { Events } from 'discord.js'
import { createDiscordClient } from './discord-client'

const TOKEN = 'secret-token-abc.123'

class FakeCollection<V> extends Map<string, V> {
  map<T>(fn: (value: V) => T): T[] {
    return [...this.values()].map(fn)
  }

  filter(fn: (value: V) => boolean): FakeCollection<V> {
    return new FakeCollection([...this.entries()].filter(([, v]) => fn(v)))
  }
}

interface FakeClient extends EventEmitter {
  ready: boolean
  login: jest.Mock<Promise<string>, [string]>
  destroy: jest.Mock<Promise<void>, []>
  isReady: () => boolean
  user: { tag: string, id: string } | null
  guilds: { cache: FakeCollection<unknown> }
  options: unknown
}

const mockClients: FakeClient[] = []
/** Runs on every client the module under test constructs, e.g. to script the login of one a reconnect creates. */
let mockOnCreate: ((client: FakeClient) => void) | null = null

jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js')
  const { EventEmitter: Emitter } = jest.requireActual('node:events')
  class Client extends Emitter {
    ready = false
    user: { tag: string, id: string } | null = null
    guilds = { cache: new Map() }
    login = jest.fn(async () => 'ok')
    destroy = jest.fn(async () => {
      this.ready = false
    })

    constructor(public options: unknown) {
      super()
      mockClients.push(this as unknown as FakeClient)
      mockOnCreate?.(this as unknown as FakeClient)
    }

    isReady() {
      return this.ready
    }
  }
  return { ...actual, Client }
})

function makeConfig(token = ''): Config {
  return { discord: { token } } as unknown as Config
}

function makeAppConfig(stored: string | null = null): AppConfig & { get: jest.Mock } {
  return { get: jest.fn(async () => stored), set: jest.fn(async () => {}) }
}

/** The client most recently constructed by the module under test (a logout/reconnect replaces it). */
function latestClient(): FakeClient {
  return mockClients[mockClients.length - 1]
}

/** Marks the client ready the way discord.js does: user set, then `clientReady` emitted. */
function becomeReady(client: FakeClient, guilds: unknown[] = []) {
  client.ready = true
  client.user = { tag: 'Hibiki#0001', id: 'bot-1' }
  client.guilds.cache = new FakeCollection(guilds.map(g => [(g as { id: string }).id, g]))
  client.emit(Events.ClientReady, client)
}

/** A login that becomes ready as Discord would: after the gateway handshake, not synchronously. */
function loginBecomesReady(client: FakeClient, guilds: unknown[] = []) {
  client.login.mockImplementation(async () => {
    setImmediate(() => becomeReady(client, guilds))
    return 'ok'
  })
}

function channel(id: string, name: string | null, voice: boolean) {
  return { id, name, isVoiceBased: () => voice }
}

function guild(id: string, name: string, channels: unknown[], voice?: unknown) {
  return {
    id,
    name,
    iconURL: jest.fn(({ size }: { size: number }) => `https://cdn/${id}.png?size=${size}`),
    channels: { cache: new FakeCollection(channels.map(c => [(c as { id: string }).id, c])) },
    members: { me: voice === undefined ? null : { voice } },
  }
}

function allLogLines(...spies: jest.SpyInstance[]): string {
  return spies.flatMap(s => s.mock.calls.map(args => args.map(String).join(' '))).join('\n')
}

let info: jest.SpyInstance
let warn: jest.SpyInstance
let error: jest.SpyInstance
let debug: jest.SpyInstance

beforeEach(() => {
  mockClients.length = 0
  mockOnCreate = null
  info = jest.spyOn(console, 'info').mockImplementation(() => {})
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  error = jest.spyOn(console, 'error').mockImplementation(() => {})
  debug = jest.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('createDiscordClient', () => {
  it('creates a client with the Guilds and GuildVoiceStates intents', () => {
    const { GatewayIntentBits } = jest.requireActual('discord.js')
    createDiscordClient(makeConfig(), makeAppConfig())
    expect(latestClient().options).toEqual({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] })
  })

  describe('login token resolution', () => {
    it('logs in with DISCORD_TOKEN without consulting the store', async () => {
      const appConfig = makeAppConfig('stored-token')
      const discord = createDiscordClient(makeConfig(TOKEN), appConfig)
      loginBecomesReady(latestClient())

      await discord.login()

      expect(latestClient().login).toHaveBeenCalledWith(TOKEN)
      expect(appConfig.get).not.toHaveBeenCalled()
      expect(info).toHaveBeenCalledWith('[discord]', 'Login complete')
    })

    it('falls back to the stored token when DISCORD_TOKEN is empty', async () => {
      const appConfig = makeAppConfig('stored-token')
      const discord = createDiscordClient(makeConfig(''), appConfig)
      loginBecomesReady(latestClient())

      await discord.login()

      expect(appConfig.get).toHaveBeenCalledWith('discord.token')
      expect(latestClient().login).toHaveBeenCalledWith('stored-token')
    })

    it('skips login and warns when no token is configured anywhere', async () => {
      const discord = createDiscordClient(makeConfig(''), makeAppConfig(null))

      await discord.login()

      expect(latestClient().login).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith('[discord]', 'No token configured — skipping login')
    })
  })

  describe('login readiness', () => {
    it('does not wait for clientReady when the client is ready once login resolves', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      const client = latestClient()
      client.login.mockImplementation(async () => {
        becomeReady(client)
        return 'ok'
      })

      await discord.login()

      expect(info).toHaveBeenCalledWith('[discord]', 'Login complete')
    })

    it('rejects and logs at error when clientReady never arrives', async () => {
      jest.useFakeTimers()
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())

      const pending = discord.login()
      const assertion = expect(pending).rejects.toThrow('Discord client ready timeout')
      await jest.advanceTimersByTimeAsync(15_000)
      await assertion

      expect(error).toHaveBeenCalledWith('[discord]', 'Login failed:', expect.any(Error))
    })

    it('logs a failing login at error and rethrows it', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      const failure = new Error('An invalid token was provided.')
      latestClient().login.mockRejectedValue(failure)

      await expect(discord.login()).rejects.toBe(failure)

      expect(error).toHaveBeenCalledWith('[discord]', 'Login failed:', failure)
      expect(info).not.toHaveBeenCalledWith('[discord]', 'Login complete')
    })

    it('disarms the ready timeout when login fails, so nothing rejects later', async () => {
      jest.useFakeTimers()
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      const client = latestClient()
      const listenersBefore = client.listenerCount(Events.ClientReady)
      client.login.mockRejectedValue(new Error('An invalid token was provided.'))

      await expect(discord.login()).rejects.toThrow()

      expect(jest.getTimerCount()).toBe(0)
      expect(client.listenerCount(Events.ClientReady)).toBe(listenersBefore)
    })

    it('completes a login slower than the ready timeout without an unhandled rejection', async () => {
      jest.useFakeTimers()
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
        const client = latestClient()
        client.login.mockImplementation(() => new Promise((resolve) => {
          setTimeout(() => {
            becomeReady(client)
            resolve('ok')
          }, 20_000)
        }))

        const pending = discord.login()
        await jest.advanceTimersByTimeAsync(20_000)
        await pending
        // Unhandled rejections are reported on a later macrotask.
        await new Promise(resolve => jest.requireActual('node:timers').setImmediate(resolve))

        expect(unhandled).not.toHaveBeenCalled()
        expect(info).toHaveBeenCalledWith('[discord]', 'Login complete')
      }
      finally {
        process.off('unhandledRejection', unhandled)
      }
    })
  })

  describe('getBotStatus', () => {
    it('reports not ready before clientReady', () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      expect(discord.getBotStatus()).toEqual({ ready: false })
    })

    it('reports the bot user once ready', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      loginBecomesReady(latestClient())
      await discord.login()

      expect(discord.getBotStatus()).toEqual({ ready: true, userTag: 'Hibiki#0001', userId: 'bot-1' })
    })
  })

  describe('listGuildDirectory', () => {
    it('is empty before clientReady', () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      expect(discord.listGuildDirectory()).toEqual([])
    })

    it('lists every guild with only its voice-based channels', () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      const tavern = guild('g1', 'Tavern', [
        channel('v1', 'Voice', true),
        channel('t1', 'general', false),
        channel('s1', null, true),
      ])
      becomeReady(latestClient(), [tavern, guild('g2', 'Dungeon', [])])

      expect(discord.listGuildDirectory()).toEqual([
        {
          guildId: 'g1',
          guildName: 'Tavern',
          iconUrl: 'https://cdn/g1.png?size=32',
          channels: [{ id: 'v1', name: 'Voice' }, { id: 's1', name: 's1' }],
        },
        { guildId: 'g2', guildName: 'Dungeon', iconUrl: 'https://cdn/g2.png?size=32', channels: [] },
      ])
    })
  })

  describe('destroy', () => {
    it('destroys a ready client', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      becomeReady(latestClient())

      await discord.destroy()

      expect(latestClient().destroy).toHaveBeenCalled()
      expect(info).toHaveBeenCalledWith('[discord]', 'Destroying client')
    })

    it('leaves a client that is not ready alone', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      await discord.destroy()
      expect(latestClient().destroy).not.toHaveBeenCalled()
    })
  })

  describe('logout', () => {
    it('destroys the old client even before ready and leaves a fresh one', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      const old = latestClient()

      await discord.logout()

      expect(old.destroy).toHaveBeenCalled()
      expect(mockClients).toHaveLength(2)
      expect(discord.getClient()).toBe(latestClient())
      expect(discord.getClient()).not.toBe(old)
      expect(info).toHaveBeenCalledWith('[discord]', 'Logging out (client not ready)')
    })
  })

  describe('reconnect', () => {
    it('destroys the ready client and logs in again on a fresh one', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      const old = latestClient()
      becomeReady(old)
      mockOnCreate = client => loginBecomesReady(client)

      await discord.reconnect()

      const fresh = latestClient()
      expect(old.destroy).toHaveBeenCalled()
      expect(fresh).not.toBe(old)
      expect(fresh.login).toHaveBeenCalledWith(TOKEN)
      expect(discord.getClient()).toBe(fresh)
      expect(discord.getBotStatus().ready).toBe(true)
      expect(info).toHaveBeenCalledWith('[discord]', 'Reconnecting…')
    })

    it('logs a failing re-login at error and rethrows it', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      becomeReady(latestClient())
      const failure = new Error('gateway down')
      mockOnCreate = client => client.login.mockRejectedValue(failure)

      await expect(discord.reconnect()).rejects.toBe(failure)

      expect(error).toHaveBeenCalledWith('[discord]', 'Login failed:', failure)
    })
  })

  describe('leaveVoiceChannel', () => {
    it('returns false before ready', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      await expect(discord.leaveVoiceChannel('g1')).resolves.toBe(false)
    })

    it('returns false for an unknown guild or when the bot is not in voice', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      becomeReady(latestClient(), [guild('g1', 'Tavern', [], { channelId: null })])

      await expect(discord.leaveVoiceChannel('nope')).resolves.toBe(false)
      await expect(discord.leaveVoiceChannel('g1')).resolves.toBe(false)
    })

    it('leaves through the gateway and logs it', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      const voice = { channelId: 'v1', setChannel: jest.fn(async () => {}) }
      becomeReady(latestClient(), [guild('g1', 'Tavern', [], voice)])

      await expect(discord.leaveVoiceChannel('g1')).resolves.toBe(true)

      expect(voice.setChannel).toHaveBeenCalledWith(null)
      expect(info).toHaveBeenCalledWith('[discord]', 'Left voice channel in guild g1 via gateway')
    })

    it('warns and returns false when the gateway leave fails', async () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      const failure = new Error('missing permissions')
      const voice = { channelId: 'v1', setChannel: jest.fn(async () => {
        throw failure
      }) }
      becomeReady(latestClient(), [guild('g1', 'Tavern', [], voice)])

      await expect(discord.leaveVoiceChannel('g1')).resolves.toBe(false)

      expect(warn).toHaveBeenCalledWith('[discord]', 'Could not leave voice channel in guild g1:', failure)
    })
  })

  describe('getBotVoiceStateForGuild', () => {
    it('is empty before ready and for an unknown guild', () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      expect(discord.getBotVoiceStateForGuild('g1')).toEqual({ channelId: null, channelName: null })
      becomeReady(latestClient())
      expect(discord.getBotVoiceStateForGuild('g1')).toEqual({ channelId: null, channelName: null })
    })

    it('reports the bot\'s current voice channel', () => {
      const discord = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      becomeReady(latestClient(), [
        guild('g1', 'Tavern', [], { channelId: 'v1', channel: { id: 'v1', name: 'Voice' } }),
        guild('g2', 'Dungeon', [], { channelId: null, channel: { id: 'v2', name: 'Crypt' } }),
      ])

      expect(discord.getBotVoiceStateForGuild('g1')).toEqual({ channelId: 'v1', channelName: 'Voice' })
      expect(discord.getBotVoiceStateForGuild('g2')).toEqual({ channelId: 'v2', channelName: 'Crypt' })
    })
  })

  describe('gateway event logging', () => {
    it('logs every gateway event under [discord]', () => {
      createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      const client = latestClient()
      const clientError = new Error('boom')

      becomeReady(client, [guild('g1', 'Tavern', []), guild('g2', 'Dungeon', [])])
      client.emit(Events.Error, clientError)
      client.emit(Events.Warn, 'rate limited')
      client.emit(Events.ShardDisconnect, { code: 4004 }, 0)
      client.emit(Events.ShardReconnecting, 0)
      client.emit(Events.ShardResume, 0, 12)
      client.emit(Events.Invalidated)

      expect(info).toHaveBeenCalledWith('[discord]', 'Ready as Hibiki#0001 in 2 guild(s)')
      expect(error).toHaveBeenCalledWith('[discord]', 'Client error:', clientError)
      expect(warn).toHaveBeenCalledWith('[discord]', 'rate limited')
      expect(warn).toHaveBeenCalledWith('[discord]', 'Gateway disconnected (shard 0, code 4004)')
      expect(info).toHaveBeenCalledWith('[discord]', 'Gateway reconnecting (shard 0)')
      expect(info).toHaveBeenCalledWith('[discord]', 'Gateway resumed (shard 0, 12 events replayed)')
      expect(error).toHaveBeenCalledWith('[discord]', 'Session invalidated by Discord; a reconnect is required')
    })

    it('keeps logging gateway events on the client a reconnect creates', async () => {
      const discord = createDiscordClient(makeConfig(''), makeAppConfig(null))
      await discord.reconnect()

      latestClient().emit(Events.Invalidated)

      expect(error).toHaveBeenCalledWith('[discord]', 'Session invalidated by Discord; a reconnect is required')
    })

    it('never writes the token into a log line', async () => {
      const discord = createDiscordClient(makeConfig(''), makeAppConfig(TOKEN))
      loginBecomesReady(latestClient(), [guild('g1', 'Tavern', [])])
      await discord.login()
      latestClient().emit(Events.ShardDisconnect, { code: 1000 }, 0)
      latestClient().emit(Events.Error, new Error('boom'))
      await discord.logout()

      const failing = createDiscordClient(makeConfig(TOKEN), makeAppConfig())
      latestClient().login.mockRejectedValue(new Error('An invalid token was provided.'))
      await expect(failing.login()).rejects.toThrow()

      const lines = allLogLines(debug, info, warn, error)
      expect(lines).toContain('[discord]')
      expect(lines).not.toContain(TOKEN)
    })
  })
})
