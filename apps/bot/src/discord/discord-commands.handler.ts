import type { Logger } from '@nestjs/common'
import type { Message, VoiceBasedChannel } from 'discord.js'
import type { PlayerService } from '../player/player.service'
import type { SoundLibraryService } from '../sound/sound.service'
import { FOURTEEN_DAYS_MS, MAX_LIST_ITEMS } from './constants'
import { buildPanelComponents, formatListText } from './discord-panel.builder'

export interface CommandHandlerDeps {
  player: PlayerService
  sounds: SoundLibraryService
  prefix: string
  logger: Logger
  getBotId: () => string | undefined
  getVersion: () => string
}

/**
 * Handles Discord message commands (!join, !play, etc.)
 */
export class DiscordCommandHandler {
  constructor(private readonly deps: CommandHandlerDeps) {}

  async handleJoin(message: Message): Promise<void> {
    const channel = message.member?.voice.channel as VoiceBasedChannel | null
    if (!channel) {
      await message.reply('Join a voice channel first.')
      return
    }
    await this.deps.player.connect(channel)
    await message.reply(`Connected to ${channel.name}.`)
  }

  async handleLeave(message: Message): Promise<void> {
    await this.deps.player.disconnect(message.guild!.id)
    await message.reply('Disconnected.')
  }

  async handleStop(message: Message): Promise<void> {
    await this.deps.player.stop(message.guild!.id)
    await message.reply('Playback stopped.')
  }

  async handlePlayMusic(message: Message, args: string[]): Promise<void> {
    const idOrName = args[0]
    if (!idOrName) {
      await message.reply(
        `Provide a track name or ID. Use \`${this.deps.prefix}songs\` to list.`,
      )
      return
    }

    try {
      const channel = message.member?.voice.channel as VoiceBasedChannel | null
      const file = await this.deps.player.playMusic(
        message.guild!.id,
        idOrName,
        channel ?? undefined,
      )
      await message.reply(`Playing **${file.name}**.`)
    }
    catch (err) {
      await message.reply(
        err instanceof Error ? err.message : 'Could not play that track.',
      )
    }
  }

  async handlePlayEffect(message: Message, args: string[]): Promise<void> {
    const idOrName = args[0]
    if (!idOrName) {
      await message.reply(
        `Provide an effect name or ID. Use \`${this.deps.prefix}effects\` to list.`,
      )
      return
    }

    try {
      const channel = message.member?.voice.channel as VoiceBasedChannel | null
      const file = await this.deps.player.playEffect(
        message.guild!.id,
        idOrName,
        channel ?? undefined,
      )
      await message.reply(`Triggered **${file.name}**.`)
    }
    catch (err) {
      await message.reply(
        err instanceof Error ? err.message : 'Could not play that effect.',
      )
    }
  }

  async handleListSongs(message: Message): Promise<void> {
    try {
      const list = await this.deps.sounds.list('music')
      if (list.length === 0) {
        await message.reply('No songs uploaded yet. Use the dashboard to add music.')
        return
      }
      const text = formatListText(list, MAX_LIST_ITEMS, true)
      await message.reply(`**Songs:**\n${text}\n\nUse \`${this.deps.prefix}play <name or id>\` to play.`)
    }
    catch (err) {
      this.deps.logger.warn('List songs failed', err)
      await message.reply('Failed to list songs.')
    }
  }

  async handleListEffects(message: Message): Promise<void> {
    try {
      const list = await this.deps.sounds.list('effects')
      if (list.length === 0) {
        await message.reply('No effects uploaded yet. Use the dashboard to add effects.')
        return
      }
      const text = formatListText(list, MAX_LIST_ITEMS, true)
      await message.reply(`**Effects:**\n${text}\n\nUse \`${this.deps.prefix}effect <name or id>\` to trigger.`)
    }
    catch (err) {
      this.deps.logger.warn('List effects failed', err)
      await message.reply('Failed to list effects.')
    }
  }

  async handleMenuCommand(message: Message): Promise<void> {
    const { content, components } = buildPanelComponents()
    await message.reply({ content, components })
  }

  async handleHelp(message: Message): Promise<void> {
    const p = this.deps.prefix
    const text = [
      `**${p}help** — show this list`,
      `**${p}version** — show bot version`,
      `**${p}menu** / **${p}panel** — control panel (buttons + dropdown)`,
      `**${p}join** — join your voice channel`,
      `**${p}leave** — disconnect from voice`,
      `**${p}stop** — stop playback`,
      `**${p}volume** [music|effects] [0-100] — show or set volume`,
      `**${p}songs** — list music tracks`,
      `**${p}effects** — list sound effects`,
      `**${p}play** <name or id> — play a track`,
      `**${p}effect** <name or id> — trigger an effect`,
      `**${p}delete** — clear this channel's bot messages`,
    ].join('\n')
    await message.reply({ content: `**Commands:**\n${text}` })
  }

  async handleVersion(message: Message): Promise<void> {
    const version = this.deps.getVersion()
    await message.reply(`**Hibiki** version **${version}**`)
  }

  async handleVolume(message: Message, args: string[]): Promise<void> {
    const guildId = message.guild!.id
    const reply = (content: string) => message.reply(content).catch(() => {})

    if (args.length === 0) {
      const vol = this.deps.player.getVolume(guildId)
      if (!vol) {
        await reply('Not connected here. Use `!join` first, then volume applies.')
        return
      }
      await reply(`**Volume:** Music **${vol.music}%**, Effects **${vol.effects}%**. Use \`${this.deps.prefix}volume music 80\` or \`${this.deps.prefix}volume effects 90\` to change.`)
      return
    }

    const which = args[0].toLowerCase()
    if (which !== 'music' && which !== 'effects') {
      await reply(`Use \`${this.deps.prefix}volume music <0-100>\` or \`${this.deps.prefix}volume effects <0-100>\`.`)
      return
    }

    const num = args[1] ? Number.parseInt(args[1], 10) : Number.NaN
    if (Number.isNaN(num) || num < 0 || num > 100) {
      await reply('Give a number 0–100, e.g. `!volume music 80`.')
      return
    }

    try {
      this.deps.player.setVolume(guildId, which === 'music' ? { music: num } : { effects: num })
      const vol = this.deps.player.getVolume(guildId)!
      await reply(`**${which}** volume set to **${num}%**. (Music: ${vol.music}%, Effects: ${vol.effects}%)`)
    }
    catch (err) {
      await reply(err instanceof Error ? err.message : 'Join a voice channel first.')
    }
  }

  async handleDelete(message: Message): Promise<void> {
    if (!message.guild || !message.channel?.isTextBased()) {
      await message.reply('This command only works in a server text channel.')
      return
    }

    const channel = message.channel
    if (typeof (channel as { bulkDelete?: unknown }).bulkDelete !== 'function' || typeof (channel as { send?: unknown }).send !== 'function') {
      await message.reply('This command only works in a text channel.')
      return
    }

    const textChannel = channel as { bulkDelete: (messages: unknown) => Promise<unknown>, send: (content: string) => Promise<Message> }
    const botId = this.deps.getBotId()
    if (!botId) {
      await message.reply('Bot not ready.')
      return
    }

    const fourteenDaysAgo = Date.now() - FOURTEEN_DAYS_MS
    try {
      const fetched = await channel.messages.fetch({ limit: 100 })
      const toDelete = fetched.filter(
        m => m.author.id === botId && m.createdTimestamp >= fourteenDaysAgo,
      )
      if (toDelete.size === 0) {
        await message.reply('No bot messages to clear (or they\'re older than 14 days).')
        return
      }
      await textChannel.bulkDelete(toDelete)
      await message.delete().catch(() => {})
      const reply = await textChannel.send(`Cleared **${toDelete.size}** bot message(s).`)
      setTimeout(() => reply.delete().catch(() => {}), 4000)
    }
    catch (err) {
      await message.reply(
        err instanceof Error ? err.message : 'Could not delete messages.',
      ).catch(() => {})
    }
  }
}
