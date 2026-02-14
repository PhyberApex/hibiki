import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { DiscordService } from '../discord/discord.service'
import { PlayerController } from './player.controller'
import { PlayerService } from './player.service'

describe('playerController', () => {
  let controller: PlayerController
  let player: jest.Mocked<PlayerService>
  let discord: jest.Mocked<DiscordService>

  const mockChannel = {
    id: 'ch-1',
    guildId: 'guild-1',
    name: 'General',
    isVoiceBased: () => true,
    guild: { id: 'guild-1', name: 'Guild' },
    voiceAdapterCreator: {},
  }

  beforeEach(async () => {
    player = {
      getState: jest.fn().mockResolvedValue([]),
      connect: jest.fn().mockResolvedValue({}),
      disconnect: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      playMusic: jest.fn().mockResolvedValue({ id: 't1', name: 'Track' }),
      playEffect: jest.fn().mockResolvedValue({ id: 'e1', name: 'Boom' }),
    } as unknown as jest.Mocked<PlayerService>

    discord = {
      getClient: jest.fn().mockReturnValue({
        guilds: {
          cache: {
            get: jest.fn().mockReturnValue({
              channels: {
                cache: {
                  get: jest.fn().mockReturnValue(mockChannel),
                },
              },
            }),
          },
        },
      }),
      getBotStatus: jest.fn().mockReturnValue({ ready: true, userTag: 'Bot#0' }),
      listGuildDirectory: jest.fn().mockReturnValue([
        { guildId: 'guild-1', guildName: 'Guild', channels: [{ id: 'ch-1', name: 'General' }] },
      ]),
    } as unknown as jest.Mocked<DiscordService>

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlayerController],
      providers: [
        { provide: PlayerService, useValue: player },
        { provide: DiscordService, useValue: discord },
      ],
    }).compile()

    controller = module.get<PlayerController>(PlayerController)
  })

  it('getState returns player state', async () => {
    const state = await controller.getState()
    expect(state).toEqual([])
    expect(player.getState).toHaveBeenCalled()
  })

  it('getBotStatus returns discord status', () => {
    const status = controller.getBotStatus()
    expect(status).toEqual({ ready: true, userTag: 'Bot#0' })
    expect(discord.getBotStatus).toHaveBeenCalled()
  })

  it('getGuildDirectory returns guild list', () => {
    const dir = controller.getGuildDirectory()
    expect(dir).toHaveLength(1)
    expect(dir[0].guildId).toBe('guild-1')
    expect(discord.listGuildDirectory).toHaveBeenCalled()
  })

  it('join resolves channel and connects', async () => {
    await controller.join({ guildId: 'guild-1', channelId: 'ch-1' })
    expect(player.connect).toHaveBeenCalledWith(mockChannel)
  })

  it('leave disconnects guild', async () => {
    await controller.leave('guild-1')
    expect(player.disconnect).toHaveBeenCalledWith('guild-1')
  })

  it('stop stops playback', async () => {
    await controller.stop('guild-1')
    expect(player.stop).toHaveBeenCalledWith('guild-1')
  })

  it('play returns track', async () => {
    const result = await controller.play({
      guildId: 'guild-1',
      trackId: 'track-1',
      channelId: 'ch-1',
    })
    expect(result).toEqual({ status: 'ok', track: { id: 't1', name: 'Track' } })
    expect(player.playMusic).toHaveBeenCalledWith(
      'guild-1',
      'track-1',
      mockChannel,
    )
  })

  it('effect returns effect', async () => {
    const result = await controller.effect({
      guildId: 'guild-1',
      effectId: 'e1',
    })
    expect(result).toEqual({ status: 'ok', effect: { id: 'e1', name: 'Boom' } })
    expect(player.playEffect).toHaveBeenCalledWith('guild-1', 'e1', undefined)
  })

  it('join throws when guild not found', async () => {
    discord.getClient = jest.fn().mockReturnValue({
      guilds: { cache: { get: jest.fn().mockReturnValue(undefined) } },
    })
    await expect(
      controller.join({ guildId: 'missing', channelId: 'ch-1' }),
    ).rejects.toThrow('Guild not available on bot')
  })

  it('play with no channelId passes undefined channel', async () => {
    await controller.play({
      guildId: 'guild-1',
      trackId: 'track-1',
    })
    expect(player.playMusic).toHaveBeenCalledWith('guild-1', 'track-1', undefined)
  })
})
