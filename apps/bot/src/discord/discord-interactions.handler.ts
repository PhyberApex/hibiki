import type {
  ButtonInteraction,
  Client,
  StringSelectMenuInteraction,
  VoiceBasedChannel,
} from 'discord.js'
import type { PlayerService } from '../player/player.service'
import type { SoundLibraryService } from '../sound/sound.service'
import type { GuildDirectoryEntry } from './discord.service'
import { MAX_LIST_ITEMS, MAX_MENU_OPTIONS } from './constants'
import { buildJoinMenuPayload, buildPlayMenuPayload, formatListText } from './discord-panel.builder'

export interface InteractionHandlerDeps {
  player: PlayerService
  sounds: SoundLibraryService
  client: Client
  listGuildDirectory: () => GuildDirectoryEntry[]
}

/**
 * Handles Discord button and select menu interactions.
 */
export class DiscordInteractionHandler {
  constructor(private readonly deps: InteractionHandlerDeps) {}

  /**
   * Extracts member role IDs from an interaction.
   */
  getMemberRoleIds(interaction: ButtonInteraction | StringSelectMenuInteraction): string[] {
    const member = interaction.member
    if (!member?.roles)
      return []
    return member.roles && 'cache' in member.roles
      ? Array.from((member.roles as { cache: Map<string, unknown> }).cache.keys())
      : Array.isArray(member.roles)
        ? (member.roles as string[])
        : []
  }

  /**
   * Extracts user ID from an interaction.
   */
  getUserId(interaction: ButtonInteraction | StringSelectMenuInteraction): string | null {
    const user = interaction.user ?? (interaction.member as { user?: { id?: string } } | null)?.user
    return user?.id ?? null
  }

  /**
   * Handles panel button clicks.
   */
  async handlePanelButton(interaction: ButtonInteraction): Promise<void> {
    const reply = (content: string) =>
      interaction.reply({ content, ephemeral: true }).catch(() => {})

    switch (interaction.customId) {
      case 'hibiki_btn_join':
        await this.showJoinMenu(interaction)
        break
      case 'hibiki_btn_leave':
        if (interaction.guildId) {
          await this.deps.player.disconnect(interaction.guildId)
        }
        await reply('Disconnected from voice.')
        break
      case 'hibiki_btn_stop':
        if (interaction.guildId) {
          await this.deps.player.stop(interaction.guildId)
        }
        await reply('Playback stopped.')
        break
      case 'hibiki_btn_play_music':
        await this.showPlayMusicMenu(interaction)
        break
      case 'hibiki_btn_play_effect':
        await this.showPlayEffectMenu(interaction)
        break
      case 'hibiki_btn_songs':
        await this.handleListSongsInteraction(interaction)
        break
      case 'hibiki_btn_effects':
        await this.handleListEffectsInteraction(interaction)
        break
    }
  }

  /**
   * Handles select menu interactions.
   */
  async handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    const customId = interaction.customId
    const value = interaction.values[0]

    if (customId === 'hibiki_menu_main') {
      await this.handleMainMenuSelection(interaction, value)
      return
    }

    if (customId === 'hibiki_menu_join') {
      await this.handleJoinMenuSelection(interaction, value)
      return
    }

    if (customId === 'hibiki_menu_play_music') {
      await this.handlePlayMusicSelection(interaction, value)
      return
    }

    if (customId === 'hibiki_menu_play_effect') {
      await this.handlePlayEffectSelection(interaction, value)
      return
    }

    if (customId === 'hibiki_menu_volume_music') {
      await this.handleVolumeSelection(interaction, value, 'music')
      return
    }

    if (customId === 'hibiki_menu_volume_effects') {
      await this.handleVolumeSelection(interaction, value, 'effects')
    }
  }

  private async handleMainMenuSelection(
    interaction: StringSelectMenuInteraction,
    value: string,
  ): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId) return
    switch (value) {
      case 'join':
        await this.showJoinMenu(interaction)
        break
      case 'leave':
        await this.deps.player.disconnect(guildId)
        await interaction.reply({ content: 'Disconnected from voice.', ephemeral: true }).catch(() => {})
        break
      case 'stop':
        await this.deps.player.stop(guildId)
        await interaction.reply({ content: 'Playback stopped.', ephemeral: true }).catch(() => {})
        break
      case 'play_music':
        await this.showPlayMusicMenu(interaction)
        break
      case 'play_effect':
        await this.showPlayEffectMenu(interaction)
        break
      case 'songs':
        await this.handleListSongsInteraction(interaction)
        break
      case 'effects':
        await this.handleListEffectsInteraction(interaction)
        break
    }
  }

  private async handleJoinMenuSelection(
    interaction: StringSelectMenuInteraction,
    value: string,
  ): Promise<void> {
    const [guildId, channelId] = value.split('_')
    const guild = this.deps.client.guilds.cache.get(guildId)
    const channel = guild?.channels.cache.get(channelId)

    if (!channel?.isVoiceBased()) {
      await interaction.update({ content: 'Channel not found.', components: [] }).catch(() => {})
      return
    }

    await this.deps.player.connect(channel as VoiceBasedChannel)
    await interaction.update({
      content: `Connected to **${channel.name}**.`,
      components: [],
    }).catch(() => {})
  }

  private async handlePlayMusicSelection(
    interaction: StringSelectMenuInteraction,
    value: string,
  ): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId) return
    const channel = (interaction.member as { voice?: { channel?: VoiceBasedChannel } })?.voice?.channel
    try {
      const file = await this.deps.player.playMusic(
        guildId,
        value,
        channel ?? undefined,
      )
      await interaction.update({
        content: `Playing **${file.name}**.`,
        components: [],
      }).catch(() => {})
    }
    catch (err) {
      await interaction.update({
        content: err instanceof Error ? err.message : 'Could not play that track.',
        components: [],
      }).catch(() => {})
    }
  }

  private async handlePlayEffectSelection(
    interaction: StringSelectMenuInteraction,
    value: string,
  ): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId) return
    const channel = (interaction.member as { voice?: { channel?: VoiceBasedChannel } })?.voice?.channel
    try {
      const file = await this.deps.player.playEffect(
        guildId,
        value,
        channel ?? undefined,
      )
      await interaction.update({
        content: `Triggered **${file.name}**.`,
        components: [],
      }).catch(() => {})
    }
    catch (err) {
      await interaction.update({
        content: err instanceof Error ? err.message : 'Could not play that effect.',
        components: [],
      }).catch(() => {})
    }
  }

  private async handleVolumeSelection(
    interaction: StringSelectMenuInteraction,
    value: string,
    type: 'music' | 'effects',
  ): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId) return
    const num = Number.parseInt(value, 10)
    if (Number.isNaN(num) || num < 0 || num > 100) {
      await interaction.reply({ content: 'Invalid volume.', ephemeral: true }).catch(() => {})
      return
    }

    try {
      this.deps.player.setVolume(guildId, type === 'music' ? { music: num } : { effects: num })
      const vol = this.deps.player.getVolume(guildId)!
      const message = type === 'music'
        ? `Music volume set to **${vol.music}%**. (Effects: ${vol.effects}%)`
        : `Effects volume set to **${vol.effects}%**. (Music: ${vol.music}%)`
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {})
    }
    catch (err) {
      await interaction.reply({
        content: err instanceof Error ? err.message : 'Join a voice channel first.',
        ephemeral: true,
      }).catch(() => {})
    }
  }

  async showJoinMenu(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
    const directory = this.deps.listGuildDirectory()
    const payload = buildJoinMenuPayload(directory, MAX_MENU_OPTIONS)

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {})
    }
    else {
      await interaction.reply(payload).catch(() => {})
    }
  }

  async showPlayMusicMenu(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
    const list = await this.deps.sounds.list('music')
    const payload = buildPlayMenuPayload(list, 'music', MAX_MENU_OPTIONS)

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {})
    }
    else {
      await interaction.reply(payload).catch(() => {})
    }
  }

  async showPlayEffectMenu(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
    const list = await this.deps.sounds.list('effects')
    const payload = buildPlayMenuPayload(list, 'effects', MAX_MENU_OPTIONS)

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {})
    }
    else {
      await interaction.reply(payload).catch(() => {})
    }
  }

  async handleListSongsInteraction(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ): Promise<void> {
    const send = (content: string) =>
      (interaction.replied || interaction.deferred
        ? interaction.followUp({ content, ephemeral: true })
        : interaction.reply({ content, ephemeral: true })
      ).catch(() => {})

    try {
      const list = await this.deps.sounds.list('music')
      if (list.length === 0) {
        await send('No songs uploaded yet. Use the dashboard to add music.')
        return
      }
      const text = formatListText(list, MAX_LIST_ITEMS, false)
      await send(`**Songs:**\n${text}`)
    }
    catch {
      await send('Failed to list songs.')
    }
  }

  async handleListEffectsInteraction(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ): Promise<void> {
    const send = (content: string) =>
      (interaction.replied || interaction.deferred
        ? interaction.followUp({ content, ephemeral: true })
        : interaction.reply({ content, ephemeral: true })
      ).catch(() => {})

    try {
      const list = await this.deps.sounds.list('effects')
      if (list.length === 0) {
        await send('No effects uploaded yet. Use the dashboard to add effects.')
        return
      }
      const text = formatListText(list, MAX_LIST_ITEMS, false)
      await send(`**Effects:**\n${text}`)
    }
    catch {
      await send('Failed to list effects.')
    }
  }
}
