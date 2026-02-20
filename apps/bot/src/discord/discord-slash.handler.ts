import type {
  ChatInputCommandInteraction,
  TextChannel,
  VoiceBasedChannel,
} from 'discord.js'
import type { PlayerService } from '../player/player.service'
import type { SoundLibraryService } from '../sound/sound.service'
import type { GuildDirectoryEntry } from './discord.service'
import { FOURTEEN_DAYS_MS, MAX_LIST_ITEMS } from './constants'
import { buildPanelComponents, formatListText } from './discord-panel.builder'

export interface SlashHandlerDeps {
  player: PlayerService
  sounds: SoundLibraryService
  listGuildDirectory: () => GuildDirectoryEntry[]
  getBotId: () => string | undefined
}

/**
 * Handles Discord slash (application) commands.
 */
export class DiscordSlashHandler {
  constructor(private readonly deps: SlashHandlerDeps) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    const name = interaction.commandName as string
    const reply = (content: string, ephemeral = false) =>
      interaction.reply({ content, ephemeral }).catch(() => {})

    switch (name) {
      case 'help':
        await this.handleHelp(interaction)
        break
      case 'menu':
      case 'panel':
        await this.handleMenu(interaction)
        break
      case 'join':
        await this.handleJoin(interaction)
        break
      case 'leave':
        await this.handleLeave(interaction)
        break
      case 'stop':
        await this.handleStop(interaction)
        break
      case 'volume':
        await this.handleVolume(interaction)
        break
      case 'songs':
        await this.handleSongs(interaction)
        break
      case 'effects':
        await this.handleEffects(interaction)
        break
      case 'play':
        await this.handlePlay(interaction)
        break
      case 'effect':
        await this.handleEffect(interaction)
        break
      case 'delete':
        await this.handleDelete(interaction)
        break
      default:
        await reply('Unknown command.')
    }
  }

  private async handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
    const text = [
      '**/help** — show this list',
      '**/menu** or **/panel** — control panel (buttons + dropdown)',
      '**/join** — join your voice channel',
      '**/leave** — disconnect from voice',
      '**/stop** — stop playback',
      '**/volume** [type] [0-100] — show or set volume',
      '**/songs** — list music tracks',
      '**/effects** — list sound effects',
      '**/play** <track> — play a track',
      '**/effect** <name> — trigger an effect',
      '**/delete** — clear this channel\'s bot messages',
    ].join('\n')
    await interaction.reply({ content: `**Commands:**\n${text}` }).catch(() => {})
  }

  private async handleMenu(interaction: ChatInputCommandInteraction): Promise<void> {
    const { content, components } = buildPanelComponents()
    await interaction.reply({ content, components }).catch(() => {})
  }

  private getVoiceChannel(interaction: ChatInputCommandInteraction): VoiceBasedChannel | null | undefined {
    const member = interaction.member as { voice?: { channel?: VoiceBasedChannel } } | null
    return member?.voice?.channel
  }

  private async handleJoin(interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = this.getVoiceChannel(interaction)
    if (!channel) {
      await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true }).catch(() => {})
      return
    }
    await this.deps.player.connect(channel)
    await interaction.reply(`Connected to ${channel.name}.`).catch(() => {})
  }

  private async handleLeave(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId) {
      await interaction.reply({ content: 'This command only works in a server.', ephemeral: true }).catch(() => {})
      return
    }
    await this.deps.player.disconnect(guildId)
    await interaction.reply('Disconnected.').catch(() => {})
  }

  private async handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId)
      return
    await this.deps.player.stop(guildId)
    await interaction.reply('Playback stopped.').catch(() => {})
  }

  private async handleVolume(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId)
      return

    const typeOpt = interaction.options.getString('type')
    const valueOpt = interaction.options.getInteger('value')

    if (!typeOpt && valueOpt == null) {
      const vol = this.deps.player.getVolume(guildId)
      if (!vol) {
        await interaction.reply({
          content: 'Not connected here. Use /join first, then volume applies.',
          ephemeral: true,
        }).catch(() => {})
        return
      }
      await interaction.reply({
        content: `**Volume:** Music **${vol.music}%**, Effects **${vol.effects}%**. Use \`/volume type:Music value:80\` to change.`,
      }).catch(() => {})
      return
    }

    const which = (typeOpt ?? 'music').toLowerCase()
    if (which !== 'music' && which !== 'effects') {
      await interaction.reply({
        content: 'Use type **Music** or **Effects** and optionally **value** 0–100.',
        ephemeral: true,
      }).catch(() => {})
      return
    }

    if (valueOpt == null || valueOpt < 0 || valueOpt > 100) {
      await interaction.reply({
        content: 'Provide a **value** between 0 and 100.',
        ephemeral: true,
      }).catch(() => {})
      return
    }

    try {
      this.deps.player.setVolume(guildId, which === 'music' ? { music: valueOpt } : { effects: valueOpt })
      const vol = this.deps.player.getVolume(guildId)!
      await interaction.reply(
        `**${which}** volume set to **${valueOpt}%**. (Music: ${vol.music}%, Effects: ${vol.effects}%)`,
      ).catch(() => {})
    }
    catch (err) {
      await interaction.reply({
        content: err instanceof Error ? err.message : 'Join a voice channel first.',
        ephemeral: true,
      }).catch(() => {})
    }
  }

  private async handleSongs(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const list = await this.deps.sounds.list('music')
      if (list.length === 0) {
        await interaction.reply({
          content: 'No songs uploaded yet. Use the dashboard to add music.',
          ephemeral: true,
        }).catch(() => {})
        return
      }
      const text = formatListText(list, MAX_LIST_ITEMS, true)
      await interaction.reply({
        content: `**Songs:**\n${text}\n\nUse \`/play track:<name or id>\` to play.`,
      }).catch(() => {})
    }
    catch {
      await interaction.reply({ content: 'Failed to list songs.', ephemeral: true }).catch(() => {})
    }
  }

  private async handleEffects(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const list = await this.deps.sounds.list('effects')
      if (list.length === 0) {
        await interaction.reply({
          content: 'No effects uploaded yet. Use the dashboard to add effects.',
          ephemeral: true,
        }).catch(() => {})
        return
      }
      const text = formatListText(list, MAX_LIST_ITEMS, true)
      await interaction.reply({
        content: `**Effects:**\n${text}\n\nUse \`/effect name:<name or id>\` to trigger.`,
      }).catch(() => {})
    }
    catch {
      await interaction.reply({ content: 'Failed to list effects.', ephemeral: true }).catch(() => {})
    }
  }

  private async handlePlay(interaction: ChatInputCommandInteraction): Promise<void> {
    const idOrName = interaction.options.getString('track', true)
    const guildId = interaction.guildId
    if (!guildId)
      return

    try {
      const channel = this.getVoiceChannel(interaction) ?? undefined
      const file = await this.deps.player.playMusic(guildId, idOrName, channel)
      await interaction.reply(`Playing **${file.name}**.`).catch(() => {})
    }
    catch (err) {
      await interaction.reply({
        content: err instanceof Error ? err.message : 'Could not play that track.',
        ephemeral: true,
      }).catch(() => {})
    }
  }

  private async handleEffect(interaction: ChatInputCommandInteraction): Promise<void> {
    const idOrName = interaction.options.getString('name', true)
    const guildId = interaction.guildId
    if (!guildId)
      return

    try {
      const channel = this.getVoiceChannel(interaction) ?? undefined
      const file = await this.deps.player.playEffect(guildId, idOrName, channel)
      await interaction.reply(`Triggered **${file.name}**.`).catch(() => {})
    }
    catch (err) {
      await interaction.reply({
        content: err instanceof Error ? err.message : 'Could not play that effect.',
        ephemeral: true,
      }).catch(() => {})
    }
  }

  private async handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = interaction.channel
    if (!channel?.isTextBased() || channel.isDMBased()) {
      await interaction.reply({
        content: 'This command only works in a server text channel.',
        ephemeral: true,
      }).catch(() => {})
      return
    }

    const textChannel = channel as TextChannel
    if (typeof textChannel.bulkDelete !== 'function' || typeof textChannel.messages?.fetch !== 'function') {
      await interaction.reply({
        content: 'This command only works in a text channel.',
        ephemeral: true,
      }).catch(() => {})
      return
    }

    const botId = this.deps.getBotId()
    if (!botId) {
      await interaction.reply({ content: 'Bot not ready.', ephemeral: true }).catch(() => {})
      return
    }

    await interaction.deferReply({ ephemeral: true }).catch(() => {})

    const fourteenDaysAgo = Date.now() - FOURTEEN_DAYS_MS
    try {
      const fetched = await textChannel.messages.fetch({ limit: 100 })
      const toDelete = fetched.filter(
        m => m.author.id === botId && m.createdTimestamp >= fourteenDaysAgo,
      )
      if (toDelete.size === 0) {
        await interaction.editReply('No bot messages to clear (or they\'re older than 14 days).').catch(() => {})
        return
      }
      await textChannel.bulkDelete(toDelete)
      await interaction.editReply(`Cleared **${toDelete.size}** bot message(s).`).catch(() => {})
    }
    catch (err) {
      await interaction.editReply(
        err instanceof Error ? err.message : 'Could not delete messages.',
      ).catch(() => {})
    }
  }
}
