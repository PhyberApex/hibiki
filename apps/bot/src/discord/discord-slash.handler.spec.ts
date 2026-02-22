import type { ChatInputCommandInteraction } from 'discord.js'
import type { PlayerService } from '../player/player.service'
import type { SoundLibraryService } from '../sound/sound.service'
import { DiscordSlashHandler } from './discord-slash.handler'

function createMockInteraction(overrides: Partial<{
  commandName: string
  guildId: string | null
  reply: jest.Mock
  options: { getString: jest.Mock, getInteger: jest.Mock }
  member: { voice?: { channel?: unknown } } | null
  channel: unknown
  deferReply: jest.Mock
  editReply: jest.Mock
}> = {}): ChatInputCommandInteraction {
  return {
    commandName: 'help',
    guildId: 'guild-1',
    reply: jest.fn().mockResolvedValue(undefined),
    options: {
      getString: jest.fn().mockReturnValue(null),
      getInteger: jest.fn().mockReturnValue(null),
    },
    member: { voice: { channel: null } },
    channel: null,
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ChatInputCommandInteraction
}

describe('discordSlashHandler', () => {
  let handler: DiscordSlashHandler
  let player: jest.Mocked<PlayerService>
  let sounds: jest.Mocked<SoundLibraryService>
  let listGuildDirectory: jest.Mock
  let getBotId: jest.Mock
  let getVersion: jest.Mock

  beforeEach(() => {
    player = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      playMusic: jest.fn().mockResolvedValue({ name: 'Track' }),
      playEffect: jest.fn().mockResolvedValue({ name: 'Boom' }),
      getVolume: jest.fn().mockReturnValue({ music: 50, effects: 50 }),
      setVolume: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      getState: jest.fn(),
    } as unknown as jest.Mocked<PlayerService>
    sounds = {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SoundLibraryService>
    listGuildDirectory = jest.fn().mockReturnValue([])
    getBotId = jest.fn().mockReturnValue('bot-id')
    getVersion = jest.fn().mockReturnValue('1.2.3')

    handler = new DiscordSlashHandler({
      player,
      sounds,
      listGuildDirectory,
      getBotId,
      getVersion,
    })
  })

  describe('handle', () => {
    it('replies Unknown command for unknown command name', async () => {
      const interaction = createMockInteraction({ commandName: 'unknown' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({ content: 'Unknown command.', ephemeral: false })
    })

    it('handleHelp: replies with commands list including /version', async () => {
      const interaction = createMockInteraction({ commandName: 'help' })
      await handler.handle(interaction)
      const content = (interaction.reply as jest.Mock).mock.calls[0][0].content
      expect(content).toContain('**Commands:**')
      expect(content).toContain('/help')
      expect(content).toContain('/version')
      expect(content).toContain('/menu')
      expect(content).toContain('/play')
    })

    it('handleVersion: replies with Hibiki version from getVersion', async () => {
      const interaction = createMockInteraction({ commandName: 'version' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith('**Hibiki** version **1.2.3**')
    })

    it('handleMenu: replies with panel content and components', async () => {
      const interaction = createMockInteraction({ commandName: 'menu' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('control panel'),
          components: expect.any(Array),
        }),
      )
    })

    it('handleMenu via panel: replies with panel', async () => {
      const interaction = createMockInteraction({ commandName: 'panel' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('control panel'),
          components: expect.any(Array),
        }),
      )
    })

    it('handleJoin: replies join voice channel first when no channel', async () => {
      const interaction = createMockInteraction({
        commandName: 'join',
        member: { voice: {} },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Join a voice channel first.',
        ephemeral: true,
      })
      expect(player.connect).not.toHaveBeenCalled()
    })

    it('handleJoin: connects and replies when in voice channel', async () => {
      const channel = { id: 'ch-1', name: 'General' }
      const interaction = createMockInteraction({
        commandName: 'join',
        member: { voice: { channel } },
      })
      await handler.handle(interaction)
      expect(player.connect).toHaveBeenCalledWith(channel)
      expect(interaction.reply).toHaveBeenCalledWith('Connected to General.')
    })

    it('handleLeave: replies only works in server when no guildId', async () => {
      const interaction = createMockInteraction({
        commandName: 'leave',
        guildId: null,
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'This command only works in a server.',
        ephemeral: true,
      })
      expect(player.disconnect).not.toHaveBeenCalled()
    })

    it('handleLeave: disconnects and replies', async () => {
      const interaction = createMockInteraction({ commandName: 'leave' })
      await handler.handle(interaction)
      expect(player.disconnect).toHaveBeenCalledWith('guild-1')
      expect(interaction.reply).toHaveBeenCalledWith('Disconnected.')
    })

    it('handleStop: does not reply when no guildId', async () => {
      const interaction = createMockInteraction({
        commandName: 'stop',
        guildId: null,
      })
      await handler.handle(interaction)
      expect(player.stop).not.toHaveBeenCalled()
      expect(interaction.reply).not.toHaveBeenCalled()
    })

    it('handleStop: stops and replies', async () => {
      const interaction = createMockInteraction({ commandName: 'stop' })
      await handler.handle(interaction)
      expect(player.stop).toHaveBeenCalledWith('guild-1')
      expect(interaction.reply).toHaveBeenCalledWith('Playback stopped.')
    })

    it('handleVolume: does not reply when no guildId', async () => {
      const interaction = createMockInteraction({
        commandName: 'volume',
        guildId: null,
        options: {
          getString: jest.fn().mockReturnValue(null),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).not.toHaveBeenCalled()
    })

    it('handleVolume: replies not connected when getVolume returns undefined', async () => {
      player.getVolume = jest.fn().mockReturnValue(undefined)
      const interaction = createMockInteraction({
        commandName: 'volume',
        options: {
          getString: jest.fn().mockReturnValue(null),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Not connected here. Use /join first, then volume applies.',
        ephemeral: true,
      })
    })

    it('handleVolume: replies current volume when no type/value', async () => {
      const interaction = createMockInteraction({
        commandName: 'volume',
        options: {
          getString: jest.fn().mockReturnValue(null),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      const content = (interaction.reply as jest.Mock).mock.calls[0][0].content
      expect(content).toContain('Music **50%**')
      expect(content).toContain('Effects **50%**')
    })

    it('handleVolume: replies use Music or Effects when invalid type', async () => {
      const interaction = createMockInteraction({
        commandName: 'volume',
        options: {
          getString: jest.fn().mockReturnValue('invalid'),
          getInteger: jest.fn().mockReturnValue(80),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Use type **Music** or **Effects** and optionally **value** 0–100.',
        ephemeral: true,
      })
    })

    it('handleVolume: replies provide value when value null', async () => {
      const interaction = createMockInteraction({
        commandName: 'volume',
        options: {
          getString: jest.fn().mockReturnValue('music'),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Provide a **value** between 0 and 100.',
        ephemeral: true,
      })
    })

    it('handleVolume: replies provide value when value out of range', async () => {
      const interaction = createMockInteraction({
        commandName: 'volume',
        options: {
          getString: jest.fn().mockReturnValue('music'),
          getInteger: jest.fn().mockReturnValue(150),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Provide a **value** between 0 and 100.',
        ephemeral: true,
      })
    })

    it('handleVolume: sets music volume and replies', async () => {
      const interaction = createMockInteraction({
        commandName: 'volume',
        options: {
          getString: jest.fn().mockReturnValue('music'),
          getInteger: jest.fn().mockReturnValue(80),
        },
      })
      await handler.handle(interaction)
      expect(player.setVolume).toHaveBeenCalledWith('guild-1', { music: 80 })
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.stringContaining('**music** volume set to **80%**'),
      )
    })

    it('handleVolume: sets effects volume and replies', async () => {
      const interaction = createMockInteraction({
        commandName: 'volume',
        options: {
          getString: jest.fn().mockReturnValue('effects'),
          getInteger: jest.fn().mockReturnValue(70),
        },
      })
      await handler.handle(interaction)
      expect(player.setVolume).toHaveBeenCalledWith('guild-1', { effects: 70 })
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.stringContaining('**effects** volume set to **70%**'),
      )
    })

    it('handleVolume: replies error message when setVolume throws Error', async () => {
      player.setVolume = jest.fn().mockImplementation(() => {
        throw new Error('Not in channel')
      })
      const interaction = createMockInteraction({
        commandName: 'volume',
        options: {
          getString: jest.fn().mockReturnValue('music'),
          getInteger: jest.fn().mockReturnValue(50),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Not in channel',
        ephemeral: true,
      })
    })

    it('handleVolume: replies generic message when setVolume throws non-Error', async () => {
      player.setVolume = jest.fn().mockImplementation(() => {
        throw Object.create(null)
      })
      const interaction = createMockInteraction({
        commandName: 'volume',
        options: {
          getString: jest.fn().mockReturnValue('music'),
          getInteger: jest.fn().mockReturnValue(50),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Join a voice channel first.',
        ephemeral: true,
      })
    })

    it('handleSongs: replies no songs when list empty', async () => {
      sounds.list = jest.fn().mockResolvedValue([])
      const interaction = createMockInteraction({ commandName: 'songs' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'No songs uploaded yet. Use the dashboard to add music.',
        ephemeral: true,
      })
    })

    it('handleSongs: replies with list when songs exist', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ id: '1', name: 'Song A' }])
      const interaction = createMockInteraction({ commandName: 'songs' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Songs:**'),
          content: expect.stringContaining('Song A'),
          content: expect.stringContaining('/play'),
        }),
      )
    })

    it('handleSongs: replies failed when list throws', async () => {
      sounds.list = jest.fn().mockRejectedValue(new Error('db error'))
      const interaction = createMockInteraction({ commandName: 'songs' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Failed to list songs.',
        ephemeral: true,
      })
    })

    it('handleEffects: replies no effects when list empty', async () => {
      sounds.list = jest.fn().mockResolvedValue([])
      const interaction = createMockInteraction({ commandName: 'effects' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'No effects uploaded yet. Use the dashboard to add effects.',
        ephemeral: true,
      })
    })

    it('handleEffects: replies with list when effects exist', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ id: '1', name: 'Boom' }])
      const interaction = createMockInteraction({ commandName: 'effects' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Effects:**'),
          content: expect.stringContaining('Boom'),
          content: expect.stringContaining('/effect'),
        }),
      )
    })

    it('handleEffects: replies failed when list throws', async () => {
      sounds.list = jest.fn().mockRejectedValue(new Error('err'))
      const interaction = createMockInteraction({ commandName: 'effects' })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Failed to list effects.',
        ephemeral: true,
      })
    })

    it('handlePlay: does not reply when no guildId', async () => {
      const interaction = createMockInteraction({
        commandName: 'play',
        guildId: null,
        options: {
          getString: jest.fn().mockImplementation((name: string) => (name === 'track' ? 'my-track' : null)),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(player.playMusic).not.toHaveBeenCalled()
      expect(interaction.reply).not.toHaveBeenCalled()
    })

    it('handlePlay: plays and replies', async () => {
      const interaction = createMockInteraction({
        commandName: 'play',
        options: {
          getString: jest.fn().mockImplementation((name: string) => (name === 'track' ? 'my-track' : null)),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(player.playMusic).toHaveBeenCalledWith('guild-1', 'my-track', undefined)
      expect(interaction.reply).toHaveBeenCalledWith('Playing **Track**.')
    })

    it('handlePlay: replies error when playMusic throws', async () => {
      player.playMusic = jest.fn().mockRejectedValue(new Error('Track not found'))
      const interaction = createMockInteraction({
        commandName: 'play',
        options: {
          getString: jest.fn().mockImplementation((name: string) => (name === 'track' ? 'x' : null)),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Track not found',
        ephemeral: true,
      })
    })

    it('handlePlay: replies generic error when throw is not Error', async () => {
      player.playMusic = jest.fn().mockRejectedValue('string')
      const interaction = createMockInteraction({
        commandName: 'play',
        options: {
          getString: jest.fn().mockImplementation((name: string) => (name === 'track' ? 'x' : null)),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Could not play that track.',
        ephemeral: true,
      })
    })

    it('handleEffect: does not reply when no guildId', async () => {
      const interaction = createMockInteraction({
        commandName: 'effect',
        guildId: null,
        options: {
          getString: jest.fn().mockImplementation((name: string) => (name === 'name' ? 'boom' : null)),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(player.playEffect).not.toHaveBeenCalled()
      expect(interaction.reply).not.toHaveBeenCalled()
    })

    it('handleEffect: plays effect and replies', async () => {
      const interaction = createMockInteraction({
        commandName: 'effect',
        options: {
          getString: jest.fn().mockImplementation((name: string) => (name === 'name' ? 'boom' : null)),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(player.playEffect).toHaveBeenCalledWith('guild-1', 'boom', undefined)
      expect(interaction.reply).toHaveBeenCalledWith('Triggered **Boom**.')
    })

    it('handleEffect: replies error when playEffect throws', async () => {
      player.playEffect = jest.fn().mockRejectedValue(new Error('Effect missing'))
      const interaction = createMockInteraction({
        commandName: 'effect',
        options: {
          getString: jest.fn().mockImplementation((name: string) => (name === 'name' ? 'x' : null)),
          getInteger: jest.fn().mockReturnValue(null),
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Effect missing',
        ephemeral: true,
      })
    })

    it('handleDelete: replies when channel not text based', async () => {
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: { isTextBased: () => false, isDMBased: () => false },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'This command only works in a server text channel.',
        ephemeral: true,
      })
    })

    it('handleDelete: replies when channel is DM', async () => {
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: { isTextBased: () => true, isDMBased: () => true },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'This command only works in a server text channel.',
        ephemeral: true,
      })
    })

    it('handleDelete: replies when text channel has no bulkDelete', async () => {
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: {
          isTextBased: () => true,
          isDMBased: () => false,
          bulkDelete: undefined,
          messages: { fetch: jest.fn() },
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'This command only works in a text channel.',
        ephemeral: true,
      })
    })

    it('handleDelete: replies when text channel has no messages.fetch', async () => {
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: {
          isTextBased: () => true,
          isDMBased: () => false,
          bulkDelete: jest.fn(),
          messages: undefined,
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'This command only works in a text channel.',
        ephemeral: true,
      })
    })

    it('handleDelete: replies bot not ready when getBotId returns undefined', async () => {
      getBotId.mockReturnValue(undefined)
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: {
          isTextBased: () => true,
          isDMBased: () => false,
          bulkDelete: jest.fn(),
          messages: { fetch: jest.fn().mockResolvedValue(new Map()) },
        },
      })
      await handler.handle(interaction)
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Bot not ready.',
        ephemeral: true,
      })
    })

    it('handleDelete: defers then editReply no messages to clear', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        filter: () => new Map(),
      })
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: {
          isTextBased: () => true,
          isDMBased: () => false,
          bulkDelete: jest.fn(),
          messages: { fetch: fetchMock },
        },
      })
      await handler.handle(interaction)
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true })
      expect(interaction.editReply).toHaveBeenCalledWith(
        'No bot messages to clear (or they\'re older than 14 days).',
      )
      expect(interaction.channel?.messages?.fetch).toHaveBeenCalledWith({ limit: 100 })
    })

    it('handleDelete: fetches, bulkDeletes bot messages and editReplies count', async () => {
      const bulkDeleteMock = jest.fn().mockResolvedValue(undefined)
      const botMsg = {
        author: { id: 'bot-id' },
        createdTimestamp: Date.now() - 1000,
      }
      const toDelete = new Map([['1', botMsg]])
      const fetchMock = jest.fn().mockResolvedValue({
        filter: () => toDelete,
      })
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: {
          isTextBased: () => true,
          isDMBased: () => false,
          bulkDelete: bulkDeleteMock,
          messages: { fetch: fetchMock },
        },
      })
      await handler.handle(interaction)
      expect(bulkDeleteMock).toHaveBeenCalledWith(toDelete)
      expect(interaction.editReply).toHaveBeenCalledWith('Cleared **1** bot message(s).')
    })

    it('handleDelete: filters out messages older than 14 days', async () => {
      const bulkDeleteMock = jest.fn().mockResolvedValue(undefined)
      const fetchMock = jest.fn().mockResolvedValue({
        filter: () => new Map(),
      })
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: {
          isTextBased: () => true,
          isDMBased: () => false,
          bulkDelete: bulkDeleteMock,
          messages: { fetch: fetchMock },
        },
      })
      await handler.handle(interaction)
      expect(bulkDeleteMock).not.toHaveBeenCalled()
      expect(interaction.editReply).toHaveBeenCalledWith(
        'No bot messages to clear (or they\'re older than 14 days).',
      )
    })

    it('handleDelete: editReply error when fetch throws', async () => {
      const fetchMock = jest.fn().mockRejectedValue(new Error('No permission'))
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: {
          isTextBased: () => true,
          isDMBased: () => false,
          bulkDelete: jest.fn(),
          messages: { fetch: fetchMock },
        },
      })
      await handler.handle(interaction)
      expect(interaction.editReply).toHaveBeenCalledWith('No permission')
    })

    it('handleDelete: editReply generic error when throw is not Error', async () => {
      const fetchMock = jest.fn().mockRejectedValue('string')
      const interaction = createMockInteraction({
        commandName: 'delete',
        channel: {
          isTextBased: () => true,
          isDMBased: () => false,
          bulkDelete: jest.fn(),
          messages: { fetch: fetchMock },
        },
      })
      await handler.handle(interaction)
      expect(interaction.editReply).toHaveBeenCalledWith('Could not delete messages.')
    })
  })
})
