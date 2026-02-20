import type { Logger } from '@nestjs/common'
import type { Message, VoiceBasedChannel } from 'discord.js'
import type { PlayerService } from '../player/player.service'
import type { SoundLibraryService } from '../sound/sound.service'
import { DiscordCommandHandler } from './discord-commands.handler'

function createMockMessage(overrides: Partial<{
  reply: jest.Mock
  delete: jest.Mock
  guild: { id: string } | null
  channel: { isTextBased: () => boolean, messages: { fetch: jest.Mock }, bulkDelete?: jest.Mock, send?: jest.Mock }
  member: { voice: { channel: VoiceBasedChannel | null } } | null
  author: { id: string }
}> = {}): Message {
  return {
    reply: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    guild: { id: 'guild-1' },
    channel: {
      isTextBased: () => true,
      messages: { fetch: jest.fn().mockResolvedValue(new Map()) },
      bulkDelete: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue({ delete: jest.fn().mockResolvedValue(undefined) }),
    },
    member: { voice: { channel: null } },
    author: { id: 'user-1' },
    ...overrides,
  } as unknown as Message
}

describe('discordCommandHandler', () => {
  let handler: DiscordCommandHandler
  let player: jest.Mocked<PlayerService>
  let sounds: jest.Mocked<SoundLibraryService>
  let logger: jest.Mocked<Logger>

  beforeEach(() => {
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

    logger = {
      warn: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<Logger>

    handler = new DiscordCommandHandler({
      player,
      sounds,
      prefix: '!',
      logger,
      getBotId: () => 'bot-id',
    })
  })

  describe('handleJoin', () => {
    it('replies to join voice channel first when member has no voice channel', async () => {
      const message = createMockMessage({ member: { voice: { channel: null } } })
      await handler.handleJoin(message)
      expect(message.reply).toHaveBeenCalledWith('Join a voice channel first.')
      expect(player.connect).not.toHaveBeenCalled()
    })

    it('connects and replies when member is in a voice channel', async () => {
      const channel = { id: 'ch-1', name: 'General', isVoiceBased: () => true, guildId: 'guild-1', voiceAdapterCreator: {} } as unknown as VoiceBasedChannel
      const message = createMockMessage({ member: { voice: { channel } } })
      await handler.handleJoin(message)
      expect(player.connect).toHaveBeenCalledWith(channel)
      expect(message.reply).toHaveBeenCalledWith('Connected to General.')
    })
  })

  describe('handleLeave', () => {
    it('disconnects and replies', async () => {
      const message = createMockMessage()
      await handler.handleLeave(message)
      expect(player.disconnect).toHaveBeenCalledWith('guild-1')
      expect(message.reply).toHaveBeenCalledWith('Disconnected.')
    })
  })

  describe('handleStop', () => {
    it('stops and replies', async () => {
      const message = createMockMessage()
      await handler.handleStop(message)
      expect(player.stop).toHaveBeenCalledWith('guild-1')
      expect(message.reply).toHaveBeenCalledWith('Playback stopped.')
    })
  })

  describe('handlePlayMusic', () => {
    it('replies with usage when no args', async () => {
      const message = createMockMessage()
      await handler.handlePlayMusic(message, [])
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('Provide a track name or ID'),
      )
      expect(player.playMusic).not.toHaveBeenCalled()
    })

    it('plays and replies when args provided', async () => {
      const message = createMockMessage()
      await handler.handlePlayMusic(message, ['my-track'])
      expect(player.playMusic).toHaveBeenCalledWith('guild-1', 'my-track', undefined)
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Playing'))
    })

    it('replies with error when playMusic throws', async () => {
      player.playMusic = jest.fn().mockRejectedValue(new Error('Not found'))
      const message = createMockMessage()
      await handler.handlePlayMusic(message, ['x'])
      expect(message.reply).toHaveBeenCalledWith('Not found')
    })

    it('replies generic error when throw is not Error', async () => {
      player.playMusic = jest.fn().mockRejectedValue('string error')
      const message = createMockMessage()
      await handler.handlePlayMusic(message, ['x'])
      expect(message.reply).toHaveBeenCalledWith('Could not play that track.')
    })
  })

  describe('handlePlayEffect', () => {
    it('replies with usage when no args', async () => {
      const message = createMockMessage()
      await handler.handlePlayEffect(message, [])
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('Provide an effect name or ID'),
      )
    })

    it('plays effect and replies', async () => {
      const message = createMockMessage()
      await handler.handlePlayEffect(message, ['boom'])
      expect(player.playEffect).toHaveBeenCalledWith('guild-1', 'boom', undefined)
      expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Triggered'))
    })

    it('replies with error when playEffect throws', async () => {
      player.playEffect = jest.fn().mockRejectedValue(new Error('File missing'))
      const message = createMockMessage()
      await handler.handlePlayEffect(message, ['x'])
      expect(message.reply).toHaveBeenCalledWith('File missing')
    })
  })

  describe('handleListSongs', () => {
    it('replies empty message when no songs', async () => {
      sounds.list = jest.fn().mockResolvedValue([])
      const message = createMockMessage()
      await handler.handleListSongs(message)
      expect(message.reply).toHaveBeenCalledWith('No songs uploaded yet. Use the dashboard to add music.')
    })

    it('replies with list when songs exist', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ id: '1', name: 'Song A' }])
      const message = createMockMessage()
      await handler.handleListSongs(message)
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('**Songs:**'),
      )
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('Song A'),
      )
    })

    it('replies failed when list throws', async () => {
      sounds.list = jest.fn().mockRejectedValue(new Error('db error'))
      const message = createMockMessage()
      await handler.handleListSongs(message)
      expect(logger.warn).toHaveBeenCalled()
      expect(message.reply).toHaveBeenCalledWith('Failed to list songs.')
    })
  })

  describe('handleListEffects', () => {
    it('replies empty message when no effects', async () => {
      sounds.list = jest.fn().mockResolvedValue([])
      const message = createMockMessage()
      await handler.handleListEffects(message)
      expect(message.reply).toHaveBeenCalledWith('No effects uploaded yet. Use the dashboard to add effects.')
    })

    it('replies with list when effects exist', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ id: '1', name: 'Boom' }])
      const message = createMockMessage()
      await handler.handleListEffects(message)
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('**Effects:**'),
      )
    })

    it('replies failed when list throws', async () => {
      sounds.list = jest.fn().mockRejectedValue(new Error('err'))
      const message = createMockMessage()
      await handler.handleListEffects(message)
      expect(message.reply).toHaveBeenCalledWith('Failed to list effects.')
    })
  })

  describe('handleMenuCommand', () => {
    it('replies with content and components', async () => {
      const message = createMockMessage()
      await handler.handleMenuCommand(message)
      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('control panel'),
          components: expect.any(Array),
        }),
      )
    })
  })

  describe('handleHelp', () => {
    it('replies with commands list including prefix', async () => {
      const message = createMockMessage()
      await handler.handleHelp(message)
      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Commands:**'),
        }),
      )
      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('!help'),
        }),
      )
    })
  })

  describe('handleVolume', () => {
    it('replies not connected when no volume', async () => {
      player.getVolume = jest.fn().mockReturnValue(undefined)
      const message = createMockMessage()
      await handler.handleVolume(message, [])
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('Not connected'),
      )
    })

    it('replies current volume when no args', async () => {
      const message = createMockMessage()
      await handler.handleVolume(message, [])
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('Music **50%**'),
      )
    })

    it('replies usage when which is not music or effects', async () => {
      const message = createMockMessage()
      await handler.handleVolume(message, ['invalid'])
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('volume music'),
      )
    })

    it('replies usage when number is invalid', async () => {
      const message = createMockMessage()
      await handler.handleVolume(message, ['music', 'bad'])
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('0–100'),
      )
    })

    it('sets music volume and replies', async () => {
      const message = createMockMessage()
      await handler.handleVolume(message, ['music', '80'])
      expect(player.setVolume).toHaveBeenCalledWith('guild-1', { music: 80 })
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringContaining('**music** volume set to **80%**'),
      )
    })

    it('sets effects volume and replies', async () => {
      const message = createMockMessage()
      await handler.handleVolume(message, ['effects', '90'])
      expect(player.setVolume).toHaveBeenCalledWith('guild-1', { effects: 90 })
    })

    it('replies error when setVolume throws', async () => {
      player.setVolume = jest.fn().mockImplementation(() => {
        throw new Error('Not in channel')
      })
      const message = createMockMessage()
      await handler.handleVolume(message, ['music', '50'])
      expect(message.reply).toHaveBeenCalledWith('Not in channel')
    })
  })

  describe('handleDelete', () => {
    it('replies when no guild', async () => {
      const message = createMockMessage({ guild: null })
      await handler.handleDelete(message)
      expect(message.reply).toHaveBeenCalledWith('This command only works in a server text channel.')
    })

    it('replies when channel is not text based', async () => {
      const message = createMockMessage({
        channel: {
          isTextBased: () => false,
          messages: { fetch: jest.fn() },
        } as any,
      })
      await handler.handleDelete(message)
      expect(message.reply).toHaveBeenCalledWith('This command only works in a server text channel.')
    })

    it('replies when channel has no bulkDelete/send', async () => {
      const message = createMockMessage({
        channel: {
          isTextBased: () => true,
          messages: { fetch: jest.fn() },
        } as any,
      })
      await handler.handleDelete(message)
      expect(message.reply).toHaveBeenCalledWith('This command only works in a text channel.')
    })

    it('replies bot not ready when getBotId returns undefined', async () => {
      handler = new DiscordCommandHandler({
        player,
        sounds,
        prefix: '!',
        logger,
        getBotId: () => undefined,
      })
      const message = createMockMessage()
      await handler.handleDelete(message)
      expect(message.reply).toHaveBeenCalledWith('Bot not ready.')
    })

    it('replies no messages when none to delete', async () => {
      const emptyCollection = { filter: () => ({ size: 0 }), size: 0 }
      const message = createMockMessage({
        channel: {
          isTextBased: () => true,
          messages: { fetch: jest.fn().mockResolvedValue(emptyCollection) },
          bulkDelete: jest.fn(),
          send: jest.fn().mockResolvedValue({ delete: jest.fn() }),
        },
      })
      await handler.handleDelete(message)
      expect(message.reply).toHaveBeenCalledWith(
        expect.stringMatching(/No bot messages to clear/),
      )
    })

    it('bulk deletes and sends confirmation when messages found', async () => {
      const bulkDelete = jest.fn().mockResolvedValue(undefined)
      const send = jest.fn().mockResolvedValue({
        delete: jest.fn().mockResolvedValue(undefined),
      })
      const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000
      const msg1 = { author: { id: 'bot-id' }, createdTimestamp: fourteenDaysAgo + 1 }
      const msg2 = { author: { id: 'other' }, createdTimestamp: Date.now() }
      const fetchedCollection = {
        filter: (pred: (m: { author: { id: string }, createdTimestamp: number }) => boolean) => {
          const list = [msg1, msg2]
          const filtered = list.filter(pred)
          return { size: filtered.length, values: () => filtered }
        },
      }
      const message = createMockMessage({
        channel: {
          isTextBased: () => true,
          messages: { fetch: jest.fn().mockResolvedValue(fetchedCollection) },
          bulkDelete,
          send,
        } as any,
      })
      await handler.handleDelete(message)
      expect(bulkDelete).toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith(expect.stringContaining('Cleared **1**'))
    })
  })
})
