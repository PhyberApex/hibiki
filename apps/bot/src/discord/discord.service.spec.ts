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
  })
})
