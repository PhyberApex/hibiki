import type { TestingModule } from '@nestjs/testing'
import type { Message } from 'discord.js'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { PermissionConfigService } from '../permissions/permission-config.service'
import { PlayerService } from '../player/player.service'
import { SoundLibraryService } from '../sound/sound.service'
import { DiscordService } from './discord.service'

describe('discordService', () => {
  let service: DiscordService
  let config: jest.Mocked<ConfigService>
  let player: jest.Mocked<PlayerService>
  let sounds: jest.Mocked<SoundLibraryService>
  let permissions: jest.Mocked<PermissionConfigService>

  function createMockMessage(overrides: Partial<{
    content: string
    author: { bot: boolean, tag: string, id: string }
    guild: { id: string, name: string }
    inGuild: () => boolean
    reply: jest.Mock
    member: { roles: { cache: Map<string, unknown> }, voice?: { channel: unknown } }
  }> = {}): Message {
    return {
      content: '!menu',
      author: { bot: false, tag: 'User#0', id: 'user-1' },
      guild: { id: 'guild-1', name: 'Test Guild' },
      inGuild: () => true,
      reply: jest.fn().mockResolvedValue(undefined),
      member: { roles: { cache: new Map() }, voice: { channel: null } },
      ...overrides,
    } as unknown as Message
  }

  beforeEach(async () => {
    config = {
      get: jest.fn().mockImplementation((key: string, def: unknown) => {
        if (key === 'discord.commandPrefix')
          return '!'
        return def
      }),
    } as unknown as jest.Mocked<ConfigService>

    player = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      playMusic: jest.fn().mockResolvedValue({ name: 'Track' }),
      playEffect: jest.fn().mockResolvedValue({ name: 'Boom' }),
      getVolume: jest.fn().mockReturnValue({ music: 50, effects: 50 }),
      setVolume: jest.fn(),
      list: jest.fn(),
      getState: jest.fn(),
    } as unknown as jest.Mocked<PlayerService>
    sounds = {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SoundLibraryService>
    permissions = {
      isAllowed: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<PermissionConfigService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordService,
        { provide: ConfigService, useValue: config },
        { provide: PlayerService, useValue: player },
        { provide: SoundLibraryService, useValue: sounds },
        { provide: PermissionConfigService, useValue: permissions },
      ],
    }).compile()

    service = module.get(DiscordService)
    jest.spyOn(service.getClient(), 'isReady').mockReturnValue(true)
  })

  describe('onModuleInit', () => {
    it('logs warn and returns without logging in when token is not configured', async () => {
      config.get = jest.fn().mockImplementation((key: string, def: unknown) => {
        if (key === 'discord.token')
          return undefined
        return def
      })
      const moduleNoToken = await Test.createTestingModule({
        providers: [
          DiscordService,
          { provide: ConfigService, useValue: config },
          { provide: PlayerService, useValue: player },
          { provide: SoundLibraryService, useValue: sounds },
          { provide: PermissionConfigService, useValue: permissions },
        ],
      }).compile()
      const svc = moduleNoToken.get(DiscordService)
      const warnSpy = jest.spyOn((svc as any).logger, 'warn')
      const loginSpy = jest.spyOn(svc.getClient(), 'login')
      await svc.onModuleInit()
      expect(warnSpy).toHaveBeenCalledWith('No Discord token configured. Skipping Discord client login.')
      expect(loginSpy).not.toHaveBeenCalled()
    })

    it('logs error when login throws', async () => {
      config.get = jest.fn().mockImplementation((key: string, def: unknown) => {
        if (key === 'discord.token')
          return 'fake-token'
        return def
      })
      const moduleWithToken = await Test.createTestingModule({
        providers: [
          DiscordService,
          { provide: ConfigService, useValue: config },
          { provide: PlayerService, useValue: player },
          { provide: SoundLibraryService, useValue: sounds },
          { provide: PermissionConfigService, useValue: permissions },
        ],
      }).compile()
      const svc = moduleWithToken.get(DiscordService)
      jest.spyOn(svc.getClient(), 'login').mockRejectedValue(new Error('Invalid token'))
      const errorSpy = jest.spyOn((svc as any).logger, 'error')
      await svc.onModuleInit()
      expect(errorSpy).toHaveBeenCalledWith('Failed to login to Discord', expect.any(Error))
    })
  })

  describe('onModuleDestroy', () => {
    it('calls destroy when client is ready', async () => {
      jest.spyOn(service.getClient(), 'isReady').mockReturnValue(true)
      const destroySpy = jest.spyOn(service.getClient(), 'destroy').mockResolvedValue(undefined)
      await service.onModuleDestroy()
      expect(destroySpy).toHaveBeenCalled()
    })

    it('does not call destroy when client is not ready', async () => {
      jest.spyOn(service.getClient(), 'isReady').mockReturnValue(false)
      const destroySpy = jest.spyOn(service.getClient(), 'destroy').mockResolvedValue(undefined)
      await service.onModuleDestroy()
      expect(destroySpy).not.toHaveBeenCalled()
    })
  })

  describe('getBotStatus', () => {
    it('returns ready false when client is not ready', () => {
      jest.spyOn(service.getClient(), 'isReady').mockReturnValue(false)
      expect(service.getBotStatus()).toEqual({ ready: false })
    })

    it('returns ready true with userTag and userId when client is ready', () => {
      const client = service.getClient() as any
      client.user = { tag: 'Hibiki#1234', id: 'bot-user-id' }
      expect(service.getBotStatus()).toEqual({
        ready: true,
        userTag: 'Hibiki#1234',
        userId: 'bot-user-id',
      })
    })
  })

  describe('handleMessage (prefix commands)', () => {
    it('replies with panel when user sends !menu', async () => {
      const message = createMockMessage({ content: '!menu' })
      await (service as any).handleMessage(message)
      expect(message.reply).toHaveBeenCalledTimes(1)
      const replyArg = (message.reply as jest.Mock).mock.calls[0][0]
      expect(replyArg.content).toContain('control panel')
      expect(replyArg.components).toHaveLength(5)
    })

    it('delegates !join to command handler', async () => {
      const message = createMockMessage({
        content: '!join',
        member: {
          roles: { cache: new Map() },
          voice: { channel: { id: 'ch-1', name: 'General', isVoiceBased: () => true, guildId: 'guild-1', voiceAdapterCreator: {} } },
        },
      })
      await (service as any).handleMessage(message)
      expect(player.connect).toHaveBeenCalled()
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Connected'))
    })

    it('replies not allowed when permissions.isAllowed returns false', async () => {
      permissions.isAllowed = jest.fn().mockReturnValue(false)
      const message = createMockMessage({ content: '!menu' })
      await (service as any).handleMessage(message)
      expect(message.reply).toHaveBeenCalledWith('You are not allowed to use this bot.')
    })

    it('replies unknown command for unrecognized prefix command', async () => {
      const message = createMockMessage({ content: '!unknowncmd' })
      await (service as any).handleMessage(message)
      expect(message.reply).toHaveBeenCalledWith('Unknown command.')
    })
  })

  describe('handleInteraction (slash commands)', () => {
    it('replies with panel when user runs /menu slash command', async () => {
      const reply = jest.fn().mockResolvedValue(undefined)
      const interaction = {
        inGuild: () => true,
        guild: {},
        isChatInputCommand: () => true,
        isButton: () => false,
        isStringSelectMenu: () => false,
        commandName: 'menu',
        reply,
        member: { roles: { cache: new Map() } },
        user: { id: 'user-1' },
      }
      await (service as any).handleInteraction(interaction)
      expect(reply).toHaveBeenCalledTimes(1)
      expect(reply.mock.calls[0][0].content).toContain('control panel')
      expect(reply.mock.calls[0][0].components).toHaveLength(5)
    })

    it('replies not allowed when permissions.isAllowed returns false for slash command', async () => {
      permissions.isAllowed = jest.fn().mockReturnValue(false)
      const reply = jest.fn().mockResolvedValue(undefined)
      const interaction = {
        inGuild: () => true,
        guild: {},
        isChatInputCommand: () => true,
        isButton: () => false,
        isStringSelectMenu: () => false,
        commandName: 'help',
        reply,
        member: { roles: { cache: new Map() } },
        user: { id: 'user-1' },
      }
      await (service as any).handleInteraction(interaction)
      expect(reply).toHaveBeenCalledWith({
        content: 'You are not allowed to use this bot.',
        ephemeral: true,
      })
    })
  })

  describe('listGuildDirectory', () => {
    it('returns empty when client is not ready', () => {
      jest.spyOn(service.getClient(), 'isReady').mockReturnValue(false)
      expect(service.listGuildDirectory()).toEqual([])
    })

    it('returns guilds and voice channels when client is ready', () => {
      const voiceChannel = {
        id: 'c1',
        name: 'General',
        isVoiceBased: () => true,
      }
      const client = service.getClient() as any
      client.guilds = {
        cache: {
          map: jest.fn().mockImplementation((fn: (g: any) => any) => {
            const guild = {
              id: 'g1',
              name: 'Guild One',
              channels: {
                cache: {
                  filter: jest.fn().mockImplementation((_: (c: any) => boolean) => ({
                    map: jest.fn().mockImplementation((mapFn: (c: any) => any) =>
                      [mapFn(voiceChannel)],
                    ),
                  })),
                },
              },
            }
            return [fn(guild)]
          }),
        },
      }
      const result = service.listGuildDirectory()
      expect(result).toHaveLength(1)
      expect(result[0].guildId).toBe('g1')
      expect(result[0].guildName).toBe('Guild One')
      expect(result[0].channels).toHaveLength(1)
      expect(result[0].channels[0]).toEqual({ id: 'c1', name: 'General' })
    })
  })

  describe('handleInteraction', () => {
    it('returns without replying when not in guild', async () => {
      const interaction = {
        inGuild: () => false,
        guild: null,
        reply: jest.fn(),
      }
      await (service as any).handleInteraction(interaction)
      expect(interaction.reply).not.toHaveBeenCalled()
    })

    it('replies not allowed when permissions.isAllowed returns false for button', async () => {
      permissions.isAllowed = jest.fn().mockReturnValue(false)
      const interaction = {
        inGuild: () => true,
        guild: {},
        isChatInputCommand: () => false,
        isButton: () => true,
        isStringSelectMenu: () => false,
        reply: jest.fn().mockResolvedValue(undefined),
      }
      await (service as any).handleInteraction(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'You are not allowed to use this bot.',
        ephemeral: true,
      })
    })

    it('delegates button to interaction handler', async () => {
      const interaction = {
        inGuild: () => true,
        guild: {},
        isChatInputCommand: () => false,
        isButton: () => true,
        isStringSelectMenu: () => false,
        customId: 'hibiki_btn_leave',
        reply: jest.fn().mockResolvedValue(undefined),
        guildId: 'guild-1',
        user: { id: 'u1' },
        member: { roles: { cache: new Map() } },
      }
      await (service as any).handleInteraction(interaction)
      expect(player.disconnect).toHaveBeenCalledWith('guild-1')
    })

    it('delegates string select menu to interaction handler', async () => {
      const interaction = {
        inGuild: () => true,
        guild: {},
        isChatInputCommand: () => false,
        isButton: () => false,
        isStringSelectMenu: () => true,
        customId: 'hibiki_menu_main',
        values: ['leave'],
        reply: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue(undefined),
        guildId: 'guild-1',
        user: { id: 'u1' },
        member: { roles: { cache: new Map() } },
      }
      await (service as any).handleInteraction(interaction)
      expect(player.disconnect).toHaveBeenCalledWith('guild-1')
    })
  })

  describe('getBotVoiceStateForGuild (crash recovery)', () => {
    it('returns null when client is not ready', () => {
      jest.spyOn(service.getClient(), 'isReady').mockReturnValue(false)
      expect(service.getBotVoiceStateForGuild('guild-1')).toEqual({
        channelId: null,
        channelName: null,
      })
    })

    it('returns null when guild is not in cache', () => {
      const client = service.getClient() as any
      client.guilds = { cache: { get: jest.fn().mockReturnValue(undefined) } }
      expect(service.getBotVoiceStateForGuild('missing')).toEqual({
        channelId: null,
        channelName: null,
      })
    })

    it('returns null when bot is not in a voice channel in that guild', () => {
      const client = service.getClient() as any
      client.guilds = {
        cache: {
          get: jest.fn().mockReturnValue({
            members: { me: { voice: { channelId: null, channel: null } } },
          }),
        },
      }
      expect(service.getBotVoiceStateForGuild('guild-1')).toEqual({
        channelId: null,
        channelName: null,
      })
    })

    it('returns channelId and channelName when bot is in voice', () => {
      const client = service.getClient() as any
      client.guilds = {
        cache: {
          get: jest.fn().mockReturnValue({
            members: {
              me: {
                voice: {
                  channelId: 'ch-123',
                  channel: { id: 'ch-123', name: 'General' },
                },
              },
            },
          }),
        },
      }
      expect(service.getBotVoiceStateForGuild('guild-1')).toEqual({
        channelId: 'ch-123',
        channelName: 'General',
      })
    })

    it('uses voice.channel.id when channelId is missing', () => {
      const client = service.getClient() as any
      client.guilds = {
        cache: {
          get: jest.fn().mockReturnValue({
            members: {
              me: {
                voice: {
                  channelId: undefined,
                  channel: { id: 'ch-456', name: 'Music' },
                },
              },
            },
          }),
        },
      }
      expect(service.getBotVoiceStateForGuild('guild-1')).toEqual({
        channelId: 'ch-456',
        channelName: 'Music',
      })
    })
  })

  describe('leaveVoiceChannel', () => {
    it('returns false when client is not ready', async () => {
      jest.spyOn(service.getClient(), 'isReady').mockReturnValue(false)
      const debugSpy = jest.spyOn((service as any).logger, 'debug')
      expect(await service.leaveVoiceChannel('guild-1')).toBe(false)
      expect(debugSpy).toHaveBeenCalledWith('leaveVoiceChannel guild-1: client not ready')
    })

    it('returns false when guild is not in cache', async () => {
      const client = service.getClient() as any
      client.guilds = { cache: { get: jest.fn().mockReturnValue(undefined) } }
      const debugSpy = jest.spyOn((service as any).logger, 'debug')
      expect(await service.leaveVoiceChannel('missing')).toBe(false)
      expect(debugSpy).toHaveBeenCalledWith('leaveVoiceChannel missing: guild not in cache')
    })

    it('returns false when bot is not in a voice channel', async () => {
      const client = service.getClient() as any
      client.guilds = {
        cache: {
          get: jest.fn().mockReturnValue({
            members: { me: { voice: { channelId: null, channel: null } } },
          }),
        },
      }
      const debugSpy = jest.spyOn((service as any).logger, 'debug')
      expect(await service.leaveVoiceChannel('guild-1')).toBe(false)
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringMatching(/leaveVoiceChannel guild-1: bot not in a voice channel/),
      )
    })

    it('calls setChannel(null) and returns true on success', async () => {
      const setChannelMock = jest.fn().mockResolvedValue(undefined)
      const client = service.getClient() as any
      client.guilds = {
        cache: {
          get: jest.fn().mockReturnValue({
            members: {
              me: {
                voice: {
                  channelId: 'ch-1',
                  channel: { name: 'General' },
                  setChannel: setChannelMock,
                },
              },
            },
          }),
        },
      }
      const logSpy = jest.spyOn((service as any).logger, 'log')
      expect(await service.leaveVoiceChannel('guild-1')).toBe(true)
      expect(setChannelMock).toHaveBeenCalledWith(null)
      expect(logSpy).toHaveBeenCalledWith('Left voice channel via API for guild guild-1')
    })

    it('returns false and logs warn when setChannel throws', async () => {
      const setChannelMock = jest.fn().mockRejectedValue(new Error('Missing Permissions'))
      const client = service.getClient() as any
      client.guilds = {
        cache: {
          get: jest.fn().mockReturnValue({
            members: {
              me: {
                voice: {
                  channelId: 'ch-1',
                  setChannel: setChannelMock,
                },
              },
            },
          }),
        },
      }
      const warnSpy = jest.spyOn((service as any).logger, 'warn')
      expect(await service.leaveVoiceChannel('guild-1')).toBe(false)
      expect(warnSpy).toHaveBeenCalledWith('leaveVoiceChannel guild-1 failed: Missing Permissions')
    })
  })
})
