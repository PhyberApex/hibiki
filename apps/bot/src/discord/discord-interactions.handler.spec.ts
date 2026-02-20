import type {
  ButtonInteraction,
  Client,
  StringSelectMenuInteraction,
  VoiceBasedChannel,
} from 'discord.js'
import type { PlayerService } from '../player/player.service'
import type { SoundLibraryService } from '../sound/sound.service'
import type { GuildDirectoryEntry } from './discord.service'
import { DiscordInteractionHandler } from './discord-interactions.handler'

function createMockButtonInteraction(customId: string, overrides: Partial<{
  reply: jest.Mock
  update: jest.Mock
  followUp: jest.Mock
  guildId: string | null
  replied: boolean
  deferred: boolean
  user: { id: string }
  member: { roles: { cache: Map<string, unknown> } | string[] }
}> = {}): ButtonInteraction {
  return {
    customId,
    reply: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    guildId: 'guild-1',
    replied: false,
    deferred: false,
    user: { id: 'user-1' },
    member: { roles: { cache: new Map() } },
    ...overrides,
  } as unknown as ButtonInteraction
}

function createMockSelectMenuInteraction(
  customId: string,
  values: string[],
  overrides: Partial<{
    reply: jest.Mock
    update: jest.Mock
    followUp: jest.Mock
    guildId: string | null
    replied: boolean
    deferred: boolean
    user: { id: string }
    member: { roles: { cache: Map<string, unknown> } | string[], voice?: { channel: VoiceBasedChannel | null } }
  }> = {},
): StringSelectMenuInteraction {
  return {
    customId,
    values,
    reply: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    guildId: 'guild-1',
    replied: false,
    deferred: false,
    user: { id: 'user-1' },
    member: { roles: { cache: new Map() } },
    ...overrides,
  } as unknown as StringSelectMenuInteraction
}

describe('discordInteractionHandler', () => {
  let handler: DiscordInteractionHandler
  let player: jest.Mocked<PlayerService>
  let sounds: jest.Mocked<SoundLibraryService>
  let client: jest.Mocked<Pick<Client, 'guilds'>>

  beforeEach(() => {
    player = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      playMusic: jest.fn().mockResolvedValue({ name: 'Track' }),
      playEffect: jest.fn().mockResolvedValue({ name: 'Boom' }),
      getVolume: jest.fn().mockReturnValue({ music: 50, effects: 50 }),
      setVolume: jest.fn(),
    } as unknown as jest.Mocked<PlayerService>

    sounds = {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SoundLibraryService>

    client = {
      guilds: {
        cache: {
          get: jest.fn().mockReturnValue({
            channels: {
              cache: {
                get: jest.fn().mockReturnValue({
                  id: 'ch-1',
                  name: 'General',
                  isVoiceBased: () => true,
                }),
              },
            },
          }),
        },
      },
    } as unknown as jest.Mocked<Pick<Client, 'guilds'>>

    handler = new DiscordInteractionHandler({
      player,
      sounds,
      client: client as Client,
      listGuildDirectory: () => [],
    })
  })

  describe('getMemberRoleIds', () => {
    it('returns empty when member is null', () => {
      const i = createMockButtonInteraction('x', { member: null as any })
      expect(handler.getMemberRoleIds(i)).toEqual([])
    })

    it('returns empty when member.roles is undefined', () => {
      const i = createMockButtonInteraction('x', { member: {} as any })
      expect(handler.getMemberRoleIds(i)).toEqual([])
    })

    it('returns cache keys when roles have cache', () => {
      const cache = new Map([['role-1', {}], ['role-2', {}]])
      const i = createMockButtonInteraction('x', {
        member: { roles: { cache } } as any,
      })
      expect(handler.getMemberRoleIds(i)).toEqual(['role-1', 'role-2'])
    })

    it('returns array when roles is string array', () => {
      const i = createMockButtonInteraction('x', {
        member: { roles: ['r1', 'r2'] } as any,
      })
      expect(handler.getMemberRoleIds(i)).toEqual(['r1', 'r2'])
    })
  })

  describe('getUserId', () => {
    it('returns user.id when present', () => {
      const i = createMockButtonInteraction('x', { user: { id: 'u-1' } })
      expect(handler.getUserId(i)).toBe('u-1')
    })

    it('returns null when user and member.user missing', () => {
      const i = createMockButtonInteraction('x', { user: null as any })
      ;(i as any).member = { user: undefined }
      expect(handler.getUserId(i)).toBeNull()
    })
  })

  describe('handlePanelButton', () => {
    it('hibiki_btn_join shows join menu', async () => {
      const listGuildDirectory = jest.fn().mockReturnValue([{ guildId: 'g1', guildName: 'G', channels: [{ id: 'c1', name: 'VC' }] }])
      const h = new DiscordInteractionHandler({
        player,
        sounds,
        client: client as Client,
        listGuildDirectory,
      })
      const interaction = createMockButtonInteraction('hibiki_btn_join')
      await h.handlePanelButton(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true }),
      )
    })

    it('hibiki_btn_leave disconnects and replies', async () => {
      const interaction = createMockButtonInteraction('hibiki_btn_leave')
      await handler.handlePanelButton(interaction)
      expect(player.disconnect).toHaveBeenCalledWith('guild-1')
      expect(interaction.reply).toHaveBeenCalledWith({ content: 'Disconnected from voice.', ephemeral: true })
    })

    it('hibiki_btn_stop stops and replies', async () => {
      const interaction = createMockButtonInteraction('hibiki_btn_stop')
      await handler.handlePanelButton(interaction)
      expect(player.stop).toHaveBeenCalledWith('guild-1')
      expect(interaction.reply).toHaveBeenCalledWith({ content: 'Playback stopped.', ephemeral: true })
    })

    it('hibiki_btn_play_music shows play music menu', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ id: '1', name: 'Song' }])
      const interaction = createMockButtonInteraction('hibiki_btn_play_music')
      await handler.handlePanelButton(interaction)
      expect(sounds.list).toHaveBeenCalledWith('music')
      expect(interaction.reply).toHaveBeenCalled()
    })

    it('hibiki_btn_play_effect shows play effect menu', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ id: '1', name: 'Boom' }])
      const interaction = createMockButtonInteraction('hibiki_btn_play_effect')
      await handler.handlePanelButton(interaction)
      expect(sounds.list).toHaveBeenCalledWith('effects')
      expect(interaction.reply).toHaveBeenCalled()
    })

    it('hibiki_btn_songs lists songs', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ id: '1', name: 'A' }])
      const interaction = createMockButtonInteraction('hibiki_btn_songs')
      await handler.handlePanelButton(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Songs:**'),
          ephemeral: true,
        }),
      )
    })

    it('hibiki_btn_effects lists effects', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ id: '1', name: 'B' }])
      const interaction = createMockButtonInteraction('hibiki_btn_effects')
      await handler.handlePanelButton(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Effects:**'),
          ephemeral: true,
        }),
      )
    })
  })

  describe('handleSelectMenu', () => {
    it('hibiki_menu_main leave disconnects', async () => {
      const interaction = createMockSelectMenuInteraction('hibiki_menu_main', ['leave'])
      await handler.handleSelectMenu(interaction)
      expect(player.disconnect).toHaveBeenCalledWith('guild-1')
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Disconnected from voice.' }),
      )
    })

    it('hibiki_menu_main stop stops playback', async () => {
      const interaction = createMockSelectMenuInteraction('hibiki_menu_main', ['stop'])
      await handler.handleSelectMenu(interaction)
      expect(player.stop).toHaveBeenCalledWith('guild-1')
    })

    it('hibiki_menu_main play_music shows play music menu', async () => {
      sounds.list = jest.fn().mockResolvedValue([])
      const interaction = createMockSelectMenuInteraction('hibiki_menu_main', ['play_music'])
      await handler.handleSelectMenu(interaction)
      expect(sounds.list).toHaveBeenCalledWith('music')
    })

    it('hibiki_menu_main play_effect shows play effect menu', async () => {
      sounds.list = jest.fn().mockResolvedValue([])
      const interaction = createMockSelectMenuInteraction('hibiki_menu_main', ['play_effect'])
      await handler.handleSelectMenu(interaction)
      expect(sounds.list).toHaveBeenCalledWith('effects')
    })

    it('hibiki_menu_main songs lists songs', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ name: 'S' }])
      const interaction = createMockSelectMenuInteraction('hibiki_menu_main', ['songs'])
      await handler.handleSelectMenu(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Songs:**'),
        }),
      )
    })

    it('hibiki_menu_main effects lists effects', async () => {
      sounds.list = jest.fn().mockResolvedValue([{ name: 'E' }])
      const interaction = createMockSelectMenuInteraction('hibiki_menu_main', ['effects'])
      await handler.handleSelectMenu(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Effects:**'),
        }),
      )
    })

    it('hibiki_menu_join connects to channel', async () => {
      const channel = {
        id: 'ch-1',
        name: 'General',
        isVoiceBased: () => true,
      }
      client.guilds.cache.get = jest.fn().mockReturnValue({
        channels: { cache: { get: jest.fn().mockReturnValue(channel) } },
      })
      const interaction = createMockSelectMenuInteraction('hibiki_menu_join', ['guild-1_ch-1'])
      await handler.handleSelectMenu(interaction)
      expect(player.connect).toHaveBeenCalledWith(channel)
      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Connected to **General**') }),
      )
    })

    it('hibiki_menu_join updates with error when channel not found', async () => {
      client.guilds.cache.get = jest.fn().mockReturnValue({
        channels: { cache: { get: jest.fn().mockReturnValue(undefined) } },
      })
      const interaction = createMockSelectMenuInteraction('hibiki_menu_join', ['guild-1_ch-1'])
      await handler.handleSelectMenu(interaction)
      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Channel not found.' }),
      )
    })

    it('hibiki_menu_join updates with error when channel not voice', async () => {
      client.guilds.cache.get = jest.fn().mockReturnValue({
        channels: { cache: { get: jest.fn().mockReturnValue({ isVoiceBased: () => false }) } },
      })
      const interaction = createMockSelectMenuInteraction('hibiki_menu_join', ['guild-1_ch-1'])
      await handler.handleSelectMenu(interaction)
      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Channel not found.' }),
      )
    })

    it('hibiki_menu_play_music plays and updates', async () => {
      const interaction = createMockSelectMenuInteraction('hibiki_menu_play_music', ['track-id'])
      await handler.handleSelectMenu(interaction)
      expect(player.playMusic).toHaveBeenCalledWith('guild-1', 'track-id', undefined)
      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Playing **Track**') }),
      )
    })

    it('hibiki_menu_play_music updates with error on throw', async () => {
      player.playMusic = jest.fn().mockRejectedValue(new Error('Not found'))
      const interaction = createMockSelectMenuInteraction('hibiki_menu_play_music', ['x'])
      await handler.handleSelectMenu(interaction)
      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Not found' }),
      )
    })

    it('hibiki_menu_play_effect plays and updates', async () => {
      const interaction = createMockSelectMenuInteraction('hibiki_menu_play_effect', ['eff-id'])
      await handler.handleSelectMenu(interaction)
      expect(player.playEffect).toHaveBeenCalledWith('guild-1', 'eff-id', undefined)
      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Triggered **Boom**') }),
      )
    })

    it('hibiki_menu_play_effect updates with error on throw', async () => {
      player.playEffect = jest.fn().mockRejectedValue(new Error('Missing file'))
      const interaction = createMockSelectMenuInteraction('hibiki_menu_play_effect', ['x'])
      await handler.handleSelectMenu(interaction)
      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Missing file' }),
      )
    })

    it('hibiki_menu_volume_music sets volume and replies', async () => {
      player.getVolume = jest.fn().mockReturnValue({ music: 75, effects: 50 })
      const interaction = createMockSelectMenuInteraction('hibiki_menu_volume_music', ['75'])
      await handler.handleSelectMenu(interaction)
      expect(player.setVolume).toHaveBeenCalledWith('guild-1', { music: 75 })
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Music volume set to **75%**'),
          ephemeral: true,
        }),
      )
    })

    it('hibiki_menu_volume_effects sets effects volume', async () => {
      player.getVolume = jest.fn().mockReturnValue({ music: 50, effects: 90 })
      const interaction = createMockSelectMenuInteraction('hibiki_menu_volume_effects', ['90'])
      await handler.handleSelectMenu(interaction)
      expect(player.setVolume).toHaveBeenCalledWith('guild-1', { effects: 90 })
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Effects volume set to **90%**'),
        }),
      )
    })

    it('hibiki_menu_volume_music replies invalid when value out of range', async () => {
      const interaction = createMockSelectMenuInteraction('hibiki_menu_volume_music', ['150'])
      await handler.handleSelectMenu(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Invalid volume.' }),
      )
    })

    it('hibiki_menu_volume_music replies invalid when NaN', async () => {
      const interaction = createMockSelectMenuInteraction('hibiki_menu_volume_music', ['x'])
      await handler.handleSelectMenu(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Invalid volume.' }),
      )
    })

    it('volume selection replies error when setVolume throws', async () => {
      player.setVolume = jest.fn().mockImplementation(() => {
        throw new Error('Not in channel')
      })
      const interaction = createMockSelectMenuInteraction('hibiki_menu_volume_music', ['50'])
      await handler.handleSelectMenu(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Not in channel',
          ephemeral: true,
        }),
      )
    })
  })

  describe('showJoinMenu', () => {
    it('uses reply when not replied/deferred', async () => {
      const directory: GuildDirectoryEntry[] = [{ guildId: 'g1', guildName: 'G', channels: [] }]
      const listDir = jest.fn().mockReturnValue(directory)
      const h = new DiscordInteractionHandler({
        player,
        sounds,
        client: client as Client,
        listGuildDirectory: listDir,
      })
      const interaction = createMockButtonInteraction('x')
      await h.showJoinMenu(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true }),
      )
    })

    it('uses followUp when already replied', async () => {
      const listDir = jest.fn().mockReturnValue([])
      const h = new DiscordInteractionHandler({
        player,
        sounds,
        client: client as Client,
        listGuildDirectory: listDir,
      })
      const interaction = createMockButtonInteraction('x', { replied: true })
      await h.showJoinMenu(interaction)
      expect(interaction.followUp).toHaveBeenCalled()
    })
  })

  describe('handleListSongsInteraction', () => {
    it('sends empty message when no songs', async () => {
      sounds.list = jest.fn().mockResolvedValue([])
      const interaction = createMockButtonInteraction('x')
      await handler.handleListSongsInteraction(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('No songs uploaded'),
          ephemeral: true,
        }),
      )
    })

    it('sends failed when list throws', async () => {
      sounds.list = jest.fn().mockRejectedValue(new Error('err'))
      const interaction = createMockButtonInteraction('x')
      await handler.handleListSongsInteraction(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Failed to list songs.',
          ephemeral: true,
        }),
      )
    })
  })

  describe('handleListEffectsInteraction', () => {
    it('sends empty message when no effects', async () => {
      sounds.list = jest.fn().mockResolvedValue([])
      const interaction = createMockButtonInteraction('x')
      await handler.handleListEffectsInteraction(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('No effects uploaded'),
          ephemeral: true,
        }),
      )
    })

    it('sends failed when list throws', async () => {
      sounds.list = jest.fn().mockRejectedValue(new Error('err'))
      const interaction = createMockButtonInteraction('x')
      await handler.handleListEffectsInteraction(interaction)
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Failed to list effects.',
          ephemeral: true,
        }),
      )
    })
  })
})
