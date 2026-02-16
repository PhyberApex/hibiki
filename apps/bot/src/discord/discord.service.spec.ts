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
    guild: { name: string }
    inGuild: () => boolean
    reply: jest.Mock
    member: { roles: { cache: Map<string, unknown> } }
  }> = {}): Message {
    return {
      content: '!menu',
      author: { bot: false, tag: 'User#0', id: 'user-1' },
      guild: { name: 'Test Guild' },
      inGuild: () => true,
      reply: jest.fn().mockResolvedValue(undefined),
      member: { roles: { cache: new Map() } },
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

    player = {} as jest.Mocked<PlayerService>
    sounds = {} as jest.Mocked<SoundLibraryService>
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
        if (key === 'discord.commandPrefix')
          return '!'
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
        if (key === 'discord.commandPrefix')
          return '!'
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

  describe('handleMessage (menu/panel and new branches)', () => {
    it('logs command and replies with panel when user sends !menu', async () => {
      const logSpy = jest.spyOn((service as any).logger, 'log')
      const message = createMockMessage({ content: '!menu' })
      await (service as any).handleMessage(message)
      expect(logSpy).toHaveBeenCalledWith(
        'Command \'menu\' from User#0 in Test Guild',
      )
      expect(message.reply).toHaveBeenCalledTimes(1)
      const replyArg = (message.reply as jest.Mock).mock.calls[0][0]
      expect(replyArg.content).toContain('control panel')
      expect(replyArg.components).toHaveLength(5)
    })

    it('logs command and replies with panel when user sends !panel', async () => {
      const message = createMockMessage({ content: '!panel' })
      await (service as any).handleMessage(message)
      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('control panel'),
          components: expect.any(Array),
        }),
      )
      expect((message.reply as jest.Mock).mock.calls[0][0].components).toHaveLength(5)
    })

    it('logs debug and returns when content is prefix only (no command)', async () => {
      const debugSpy = jest.spyOn((service as any).logger, 'debug')
      const message = createMockMessage({ content: '!' })
      await (service as any).handleMessage(message)
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Prefix received but no command'),
      )
      expect(message.reply).not.toHaveBeenCalled()
    })

    it('returns without replying when content does not start with prefix', async () => {
      const message = createMockMessage({ content: 'hello' })
      await (service as any).handleMessage(message)
      expect(message.reply).not.toHaveBeenCalled()
    })

    it('uses empty string when message.content is null/undefined', async () => {
      const message = createMockMessage({ content: undefined as any })
      await (service as any).handleMessage(message)
      expect(message.reply).not.toHaveBeenCalled()
    })

    it('ignores message when author.bot is true and e2eAllowBotId is not set', async () => {
      const message = createMockMessage({ content: '!menu', author: { bot: true, tag: 'Bot#0', id: 'bot-1' } })
      await (service as any).handleMessage(message)
      expect(message.reply).not.toHaveBeenCalled()
    })

    it('processes command when author.bot is true but author.id matches e2eAllowBotId', async () => {
      config.get = jest.fn().mockImplementation((key: string, def: unknown) => {
        if (key === 'discord.commandPrefix')
          return '!'
        if (key === 'discord.e2eAllowBotId')
          return 'e2e-sidecar-id'
        return def
      })
      const moduleWithE2E = await Test.createTestingModule({
        providers: [
          DiscordService,
          { provide: ConfigService, useValue: config },
          { provide: PlayerService, useValue: player },
          { provide: SoundLibraryService, useValue: sounds },
          { provide: PermissionConfigService, useValue: permissions },
        ],
      }).compile()
      const svc = moduleWithE2E.get(DiscordService)
      jest.spyOn(svc.getClient(), 'isReady').mockReturnValue(true)
      const message = createMockMessage({
        content: '!menu',
        author: { bot: true, tag: 'E2ESidecar#0', id: 'e2e-sidecar-id' },
      })
      await (svc as any).handleMessage(message)
      expect(message.reply).toHaveBeenCalledTimes(1)
      expect((message.reply as jest.Mock).mock.calls[0][0].content).toContain('control panel')
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
