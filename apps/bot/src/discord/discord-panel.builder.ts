import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js'

/**
 * Builds the main control panel components (buttons and dropdowns).
 */
export function buildPanelComponents(): {
  content: string
  components: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[]
} {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('hibiki_btn_join')
      .setLabel('Join voice')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔊'),
    new ButtonBuilder()
      .setCustomId('hibiki_btn_leave')
      .setLabel('Leave voice')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔇'),
    new ButtonBuilder()
      .setCustomId('hibiki_btn_stop')
      .setLabel('Stop playback')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️'),
  )

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('hibiki_btn_play_music')
      .setLabel('Play music')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎵'),
    new ButtonBuilder()
      .setCustomId('hibiki_btn_play_effect')
      .setLabel('Play effect')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎶'),
    new ButtonBuilder()
      .setCustomId('hibiki_btn_songs')
      .setLabel('List songs')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('hibiki_btn_effects')
      .setLabel('List effects')
      .setStyle(ButtonStyle.Secondary),
  )

  const row3 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('hibiki_menu_main')
      .setPlaceholder('Or choose an action from dropdown…')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Join voice channel')
          .setDescription('Connect to a server and channel')
          .setValue('join'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Leave voice')
          .setDescription('Disconnect from this server')
          .setValue('leave'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Stop playback')
          .setDescription('Stop current music')
          .setValue('stop'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Play music')
          .setDescription('Choose a track to play')
          .setValue('play_music'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Play effect')
          .setDescription('Trigger a sound effect')
          .setValue('play_effect'),
        new StringSelectMenuOptionBuilder()
          .setLabel('List songs')
          .setDescription('Show available tracks')
          .setValue('songs'),
        new StringSelectMenuOptionBuilder()
          .setLabel('List effects')
          .setDescription('Show available effects')
          .setValue('effects'),
      ),
  )

  const volOpts = [0, 25, 50, 75, 100].map(n =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${n}%`)
      .setValue(String(n)),
  )

  const row4 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('hibiki_menu_volume_music')
      .setPlaceholder('Music volume…')
      .addOptions(volOpts),
  )

  const row5 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('hibiki_menu_volume_effects')
      .setPlaceholder('Effects volume…')
      .addOptions(volOpts),
  )

  return {
    content: '**🎛️ Hibiki control panel** — Use the buttons or dropdown below. This message stays here until deleted.',
    components: [row1, row2, row3, row4, row5],
  }
}

/**
 * Builds a join menu with available voice channels.
 */
export function buildJoinMenuPayload(
  directory: { guildId: string, guildName: string, channels: { id: string, name: string }[] }[],
  maxOptions: number,
): {
  content: string
  components: ActionRowBuilder<StringSelectMenuBuilder>[]
  ephemeral: true
} {
  const options: StringSelectMenuOptionBuilder[] = []

  for (const guild of directory) {
    for (const ch of guild.channels.slice(0, 5)) {
      if (options.length >= maxOptions)
        break
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${guild.guildName}: #${ch.name}`)
          .setValue(`${guild.guildId}_${ch.id}`),
      )
    }
    if (options.length >= maxOptions)
      break
  }

  return {
    content: options.length === 0
      ? 'No voice channels available.'
      : '**Join** — select a server and voice channel:',
    components: options.length === 0
      ? []
      : [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('hibiki_menu_join')
              .setPlaceholder('Select server and channel…')
              .addOptions(options),
          ),
        ],
    ephemeral: true,
  }
}

/**
 * Builds a play menu (music or effects) with available tracks.
 */
export function buildPlayMenuPayload(
  list: { id: string, name: string }[],
  type: 'music' | 'effects',
  maxOptions: number,
): {
  content: string
  components: ActionRowBuilder<StringSelectMenuBuilder>[]
  ephemeral: true
} {
  const isMusic = type === 'music'
  const emptyMessage = isMusic
    ? 'No songs uploaded yet. Use the dashboard to add music.'
    : 'No effects uploaded yet. Use the dashboard to add effects.'
  const promptMessage = isMusic
    ? '**Play music** — select a track:'
    : '**Play effect** — select an effect:'
  const customId = isMusic ? 'hibiki_menu_play_music' : 'hibiki_menu_play_effect'
  const placeholder = isMusic ? 'Choose a track…' : 'Choose an effect…'

  return {
    content: list.length === 0 ? emptyMessage : promptMessage,
    components: list.length === 0
      ? []
      : [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(customId)
              .setPlaceholder(placeholder)
              .addOptions(
                list.slice(0, maxOptions).map(s =>
                  new StringSelectMenuOptionBuilder()
                    .setLabel(s.name.length > 100 ? `${s.name.slice(0, 97)}…` : s.name)
                    .setValue(s.id),
                ),
              ),
          ),
        ],
    ephemeral: true,
  }
}

/**
 * Formats a list of items for display.
 */
export function formatListText(
  list: { id?: string, name: string }[],
  maxItems: number,
  showIds = false,
): string {
  const lines = list.slice(0, maxItems).map((s, i) =>
    showIds && s.id
      ? `${i + 1}. **${s.name}** (\`${s.id}\`)`
      : `${i + 1}. **${s.name}**`,
  )
  const text = lines.join('\n')
    + (list.length > maxItems ? `\n… and ${list.length - maxItems} more.` : '')
  return text
}
