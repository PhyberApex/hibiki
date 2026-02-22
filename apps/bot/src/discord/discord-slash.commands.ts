import { SlashCommandBuilder } from 'discord.js'

/**
 * Slash command definitions for Discord. Used for registration and routing.
 */
export const slashCommands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all Hibiki commands'),
  new SlashCommandBuilder()
    .setName('version')
    .setDescription('Show Hibiki bot version'),
  new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Post the control panel (buttons + dropdown) in this channel'),
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Same as /menu — post the control panel'),
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your current voice channel'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Disconnect from voice in this server'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback'),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Show or set music/effects volume (0–100)')
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('Which volume to get or set')
        .addChoices(
          { name: 'Music', value: 'music' },
          { name: 'Effects', value: 'effects' },
        ),
    )
    .addIntegerOption(opt =>
      opt
        .setName('value')
        .setDescription('Volume 0–100 (only when setting)')
        .setMinValue(0)
        .setMaxValue(100),
    ),
  new SlashCommandBuilder()
    .setName('songs')
    .setDescription('List available music tracks'),
  new SlashCommandBuilder()
    .setName('effects')
    .setDescription('List available sound effects'),
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song by name or id')
    .addStringOption(opt =>
      opt
        .setName('track')
        .setDescription('Track name or id (use /songs to list)')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('effect')
    .setDescription('Trigger a sound effect by name or id')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Effect name or id (use /effects to list)')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Clear this channel\'s bot messages (last 100, under 14 days)'),
]

/** Serialized payload for Discord REST API (register slash commands). */
export function getSlashCommandsJSON(): unknown[] {
  return slashCommands.map(c => c.toJSON())
}
