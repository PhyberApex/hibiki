import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  Message,
  Partials,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  VoiceBasedChannel,
} from 'discord.js';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { PlayerService } from '../player/player.service';
import { SoundLibraryService } from '../sound/sound.service';
import { PermissionConfigService } from '../permissions';

export interface GuildDirectoryEntry {
  guildId: string;
  guildName: string;
  channels: { id: string; name: string }[];
}

@Injectable()
export class DiscordService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name);
  private readonly client: Client;
  private readonly prefix: string;

  constructor(
    private readonly config: ConfigService,
    private readonly player: PlayerService,
    private readonly sounds: SoundLibraryService,
    private readonly permissions: PermissionConfigService,
  ) {
    this.prefix = this.config.get<string>('discord.commandPrefix', '!');
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
  }

  async onModuleInit() {
    const token = this.config.get<string>('discord.token');
    if (!token) {
      this.logger.warn(
        'No Discord token configured. Skipping Discord client login.',
      );
      return;
    }

    this.client.once('ready', () => {
      this.logger.log(`Logged in as ${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', (message) => {
      void this.handleMessage(message);
    });

    this.client.on('interactionCreate', (interaction) => {
      void this.handleInteraction(interaction);
    });

    try {
      await this.client.login(token);
    } catch (error) {
      this.logger.error('Failed to login to Discord', error as Error);
    }
  }

  async onModuleDestroy() {
    if (this.client.isReady()) {
      await this.client.destroy();
    }
  }

  getClient() {
    return this.client;
  }

  /** Whether the Discord client is logged in and ready (valid credentials, can join/play). */
  getBotStatus(): { ready: boolean; userTag?: string } {
    if (!this.client.isReady()) {
      return { ready: false };
    }
    const tag = this.client.user?.tag;
    return { ready: true, userTag: tag ?? undefined };
  }

  listGuildDirectory(): GuildDirectoryEntry[] {
    if (!this.client.isReady()) {
      return [];
    }

    return this.client.guilds.cache.map((guild) => ({
      guildId: guild.id,
      guildName: guild.name,
      channels: guild.channels.cache
        .filter((channel): channel is VoiceBasedChannel =>
          channel.isVoiceBased(),
        )
        .map((channel) => ({
          id: channel.id,
          name: channel.name ?? channel.id,
        })),
    }));
  }

  private async handleMessage(message: Message) {
    if (!this.client.isReady() || message.author.bot || !message.inGuild()) {
      return;
    }

    if (!message.guild || !message.content.startsWith(this.prefix)) {
      return;
    }

    const [command, ...args] = message.content
      .slice(this.prefix.length)
      .trim()
      .split(/\s+/);
    if (!command) {
      return;
    }

    const memberRoleIds = Array.from(message.member?.roles.cache.keys() ?? []);
    const userId = message.author?.id ?? null;
    if (!this.permissions.isAllowed(memberRoleIds, userId)) {
      await message.reply('You are not allowed to use this bot.');
      return;
    }

    switch (command.toLowerCase()) {
      case 'join':
        await this.handleJoin(message);
        break;
      case 'leave':
        await this.handleLeave(message);
        break;
      case 'stop':
        await this.handleStop(message);
        break;
      case 'play':
        await this.handlePlayMusic(message, args);
        break;
      case 'effect':
        await this.handlePlayEffect(message, args);
        break;
      case 'songs':
        await this.handleListSongs(message);
        break;
      case 'effects':
        await this.handleListEffects(message);
        break;
      case 'menu':
      case 'panel':
        await this.handleMenuCommand(message);
        break;
      case 'help':
        await this.handleHelp(message);
        break;
      case 'delete':
        await this.handleDelete(message);
        break;
      default:
        await message.reply('Unknown command.');
    }
  }

  /** Builds the persistent panel content + components (buttons + dropdown). */
  private buildPanelComponents(): {
    content: string;
    components: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[];
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
    );
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
    );
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
    );
    return {
      content:
        '**🎛️ Hibiki control panel** — Use the buttons or dropdown below. This message stays here until deleted.',
      components: [row1, row2, row3],
    };
  }

  private async handleMenuCommand(message: Message) {
    const { content, components } = this.buildPanelComponents();
    await message.reply({ content, components });
  }

  private getInteractionMemberRoleIds(interaction: ButtonInteraction | StringSelectMenuInteraction): string[] {
    const member = interaction.member;
    if (!member?.roles) return [];
    return member.roles && 'cache' in member.roles
      ? Array.from((member.roles as { cache: Map<string, unknown> }).cache.keys())
      : Array.isArray(member.roles)
        ? (member.roles as string[])
        : [];
  }

  private getInteractionUserId(interaction: ButtonInteraction | StringSelectMenuInteraction): string | null {
    const user = interaction.user ?? (interaction.member as { user?: { id?: string } } | null)?.user;
    return user?.id ?? null;
  }

  private async handlePanelButton(interaction: ButtonInteraction) {
    const reply = (content: string) =>
      interaction.reply({ content, ephemeral: true }).catch(() => {});

    switch (interaction.customId) {
      case 'hibiki_btn_join':
        await this.showJoinMenu(interaction);
        break;
      case 'hibiki_btn_leave':
        if (interaction.guildId) {
          await this.player.disconnect(interaction.guildId);
        }
        await reply('Disconnected from voice.');
        break;
      case 'hibiki_btn_stop':
        if (interaction.guildId) {
          await this.player.stop(interaction.guildId);
        }
        await reply('Playback stopped.');
        break;
      case 'hibiki_btn_play_music':
        await this.showPlayMusicMenu(interaction);
        break;
      case 'hibiki_btn_play_effect':
        await this.showPlayEffectMenu(interaction);
        break;
      case 'hibiki_btn_songs':
        await this.handleListSongsInteraction(interaction);
        break;
      case 'hibiki_btn_effects':
        await this.handleListEffectsInteraction(interaction);
        break;
    }
  }

  private async handleInteraction(interaction: import('discord.js').Interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;

    const i = interaction as ButtonInteraction | StringSelectMenuInteraction;
    const memberRoleIds = this.getInteractionMemberRoleIds(i);
    const userId = this.getInteractionUserId(i);
    if (!this.permissions.isAllowed(memberRoleIds, userId)) {
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        await interaction.reply({
          content: 'You are not allowed to use this bot.',
          ephemeral: true,
        }).catch(() => {});
      }
      return;
    }

    if (interaction.isButton()) {
      await this.handlePanelButton(interaction);
      return;
    }

    if (!interaction.isStringSelectMenu()) return;

    const customId = interaction.customId;
    const value = interaction.values[0];

    if (customId === 'hibiki_menu_main') {
      if (value === 'join') {
        await this.showJoinMenu(interaction);
        return;
      }
      if (value === 'leave') {
        await this.player.disconnect(interaction.guildId);
        await interaction.reply({
          content: 'Disconnected from voice.',
          ephemeral: true,
        }).catch(() => {});
        return;
      }
      if (value === 'stop') {
        await this.player.stop(interaction.guildId);
        await interaction.reply({
          content: 'Playback stopped.',
          ephemeral: true,
        }).catch(() => {});
        return;
      }
      if (value === 'play_music') {
        await this.showPlayMusicMenu(interaction);
        return;
      }
      if (value === 'play_effect') {
        await this.showPlayEffectMenu(interaction);
        return;
      }
      if (value === 'songs') {
        await this.handleListSongsInteraction(interaction);
        return;
      }
      if (value === 'effects') {
        await this.handleListEffectsInteraction(interaction);
        return;
      }
    }

    if (customId === 'hibiki_menu_join') {
      const [guildId, channelId] = value.split('_');
      const guild = this.client.guilds.cache.get(guildId);
      const channel = guild?.channels.cache.get(channelId);
      if (!channel?.isVoiceBased()) {
        await interaction.update({ content: 'Channel not found.', components: [] }).catch(() => {});
        return;
      }
      await this.player.connect(channel as VoiceBasedChannel);
      await interaction.update({
        content: `Connected to **${channel.name}**.`,
        components: [],
      }).catch(() => {});
      return;
    }

    if (customId === 'hibiki_menu_play_music') {
      const channel = (interaction.member as { voice?: { channel?: VoiceBasedChannel } })?.voice?.channel;
      try {
        const file = await this.player.playMusic(
          interaction.guildId,
          value,
          channel ?? undefined,
        );
        await interaction.update({
          content: `Playing **${file.name}**.`,
          components: [],
        }).catch(() => {});
      } catch (err) {
        await interaction.update({
          content: err instanceof Error ? err.message : 'Could not play that track.',
          components: [],
        }).catch(() => {});
      }
      return;
    }

    if (customId === 'hibiki_menu_play_effect') {
      const channel = (interaction.member as { voice?: { channel?: VoiceBasedChannel } })?.voice?.channel;
      try {
        const file = await this.player.playEffect(
          interaction.guildId,
          value,
          channel ?? undefined,
        );
        await interaction.update({
          content: `Triggered **${file.name}**.`,
          components: [],
        }).catch(() => {});
      } catch (err) {
        await interaction.update({
          content: err instanceof Error ? err.message : 'Could not play that effect.',
          components: [],
        }).catch(() => {});
      }
      return;
    }
  }

  private async showJoinMenu(interaction: ButtonInteraction | StringSelectMenuInteraction) {
    const directory = this.listGuildDirectory();
    const options: StringSelectMenuOptionBuilder[] = [];
    for (const guild of directory) {
      for (const ch of guild.channels.slice(0, 5)) {
        if (options.length >= 25) break;
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`${guild.guildName}: #${ch.name}`)
            .setValue(`${guild.guildId}_${ch.id}`),
        );
      }
      if (options.length >= 25) break;
    }
    const payload = {
      content: options.length === 0
        ? 'No voice channels available.'
        : '**Join** — select a server and voice channel:',
      components: options.length === 0 ? [] : [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('hibiki_menu_join')
            .setPlaceholder('Select server and channel…')
            .addOptions(options),
        ),
      ],
      ephemeral: true as const,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }

  private async showPlayMusicMenu(interaction: ButtonInteraction | StringSelectMenuInteraction) {
    const list = await this.sounds.list('music');
    const content = list.length === 0
      ? 'No songs uploaded yet. Use the dashboard to add music.'
      : '**Play music** — select a track:';
    const components = list.length === 0 ? [] : [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('hibiki_menu_play_music')
          .setPlaceholder('Choose a track…')
          .addOptions(
            list.slice(0, 25).map((s) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(s.name.length > 100 ? s.name.slice(0, 97) + '…' : s.name)
                .setValue(s.id),
            ),
          ),
      ),
    ];
    const payload = { content, components, ephemeral: true as const };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }

  private async showPlayEffectMenu(interaction: ButtonInteraction | StringSelectMenuInteraction) {
    const list = await this.sounds.list('effects');
    const content = list.length === 0
      ? 'No effects uploaded yet. Use the dashboard to add effects.'
      : '**Play effect** — select an effect:';
    const components = list.length === 0 ? [] : [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('hibiki_menu_play_effect')
          .setPlaceholder('Choose an effect…')
          .addOptions(
            list.slice(0, 25).map((s) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(s.name.length > 100 ? s.name.slice(0, 97) + '…' : s.name)
                .setValue(s.id),
            ),
          ),
      ),
    ];
    const payload = { content, components, ephemeral: true as const };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }

  private async handleListSongsInteraction(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ) {
    const send = (content: string) =>
      (interaction.replied || interaction.deferred
        ? interaction.followUp({ content, ephemeral: true })
        : interaction.reply({ content, ephemeral: true })
      ).catch(() => {});
    try {
      const list = await this.sounds.list('music');
      if (list.length === 0) {
        await send('No songs uploaded yet. Use the dashboard to add music.');
        return;
      }
      const lines = list.slice(0, 15).map((s, i) => `${i + 1}. **${s.name}**`);
      const text =
        lines.join('\n') +
        (list.length > 15 ? `\n… and ${list.length - 15} more.` : '');
      await send(`**Songs:**\n${text}`);
    } catch {
      await send('Failed to list songs.');
    }
  }

  private async handleListEffectsInteraction(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ) {
    const send = (content: string) =>
      (interaction.replied || interaction.deferred
        ? interaction.followUp({ content, ephemeral: true })
        : interaction.reply({ content, ephemeral: true })
      ).catch(() => {});
    try {
      const list = await this.sounds.list('effects');
      if (list.length === 0) {
        await send('No effects uploaded yet. Use the dashboard to add effects.');
        return;
      }
      const lines = list.slice(0, 15).map((s, i) => `${i + 1}. **${s.name}**`);
      const text =
        lines.join('\n') +
        (list.length > 15 ? `\n… and ${list.length - 15} more.` : '');
      await send(`**Effects:**\n${text}`);
    } catch {
      await send('Failed to list effects.');
    }
  }

  private async handleHelp(message: Message) {
    const p = this.prefix;
    const text = [
      `**${p}help** — show this list`,
      `**${p}menu** / **${p}panel** — control panel (buttons + dropdown)`,
      `**${p}join** — join your voice channel`,
      `**${p}leave** — disconnect from voice`,
      `**${p}stop** — stop playback`,
      `**${p}songs** — list music tracks`,
      `**${p}effects** — list sound effects`,
      `**${p}play** <name or id> — play a track`,
      `**${p}effect** <name or id> — trigger an effect`,
      `**${p}delete** — clear this channel's bot messages`,
    ].join('\n');
    await message.reply({ content: `**Commands:**\n${text}` });
  }

  private async handleDelete(message: Message) {
    if (!message.guild || !message.channel?.isTextBased()) {
      await message.reply('This command only works in a server text channel.');
      return;
    }
    const channel = message.channel;
    if (typeof (channel as { bulkDelete?: unknown }).bulkDelete !== 'function' || typeof (channel as { send?: unknown }).send !== 'function') {
      await message.reply('This command only works in a text channel.');
      return;
    }
    const textChannel = channel as { bulkDelete: (messages: unknown) => Promise<unknown>; send: (content: string) => Promise<Message> };
    const botId = this.client.user?.id;
    if (!botId) {
      await message.reply('Bot not ready.');
      return;
    }
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    try {
      const fetched = await channel.messages.fetch({ limit: 100 });
      const toDelete = fetched.filter(
        (m) => m.author.id === botId && m.createdTimestamp >= fourteenDaysAgo,
      );
      if (toDelete.size === 0) {
        await message.reply("No bot messages to clear (or they're older than 14 days).");
        return;
      }
      await textChannel.bulkDelete(toDelete);
      await message.delete().catch(() => {});
      const reply = await textChannel.send(`Cleared **${toDelete.size}** bot message(s).`);
      setTimeout(() => reply.delete().catch(() => {}), 4000);
    } catch (err) {
      await message.reply(
        err instanceof Error ? err.message : 'Could not delete messages.',
      ).catch(() => {});
    }
  }

  private async handleJoin(message: Message) {
    const channel = message.member?.voice.channel as VoiceBasedChannel | null;
    if (!channel) {
      await message.reply('Join a voice channel first.');
      return;
    }

    await this.player.connect(channel);
    await message.reply(`Connected to ${channel.name}.`);
  }

  private async handleLeave(message: Message) {
    await this.player.disconnect(message.guild!.id);
    await message.reply('Disconnected.');
  }

  private async handleStop(message: Message) {
    await this.player.stop(message.guild!.id);
    await message.reply('Playback stopped.');
  }

  private async handlePlayMusic(message: Message, args: string[]) {
    const idOrName = args[0];
    if (!idOrName) {
      await message.reply(
        `Provide a track name or ID. Use \`${this.prefix}songs\` to list.`,
      );
      return;
    }

    try {
      const channel = message.member?.voice.channel as VoiceBasedChannel | null;
      const file = await this.player.playMusic(
        message.guild!.id,
        idOrName,
        channel ?? undefined,
      );
      await message.reply(`Playing **${file.name}**.`);
    } catch (err) {
      await message.reply(
        err instanceof Error ? err.message : 'Could not play that track.',
      );
    }
  }

  private async handlePlayEffect(message: Message, args: string[]) {
    const idOrName = args[0];
    if (!idOrName) {
      await message.reply(
        `Provide an effect name or ID. Use \`${this.prefix}effects\` to list.`,
      );
      return;
    }

    try {
      const channel = message.member?.voice.channel as VoiceBasedChannel | null;
      const file = await this.player.playEffect(
        message.guild!.id,
        idOrName,
        channel ?? undefined,
      );
      await message.reply(`Triggered **${file.name}**.`);
    } catch (err) {
      await message.reply(
        err instanceof Error ? err.message : 'Could not play that effect.',
      );
    }
  }

  private async handleListSongs(message: Message) {
    try {
      const list = await this.sounds.list('music');
      if (list.length === 0) {
        await message.reply('No songs uploaded yet. Use the dashboard to add music.');
        return;
      }
      const maxShow = 15;
      const lines = list.slice(0, maxShow).map(
        (s, i) => `${i + 1}. **${s.name}** (\`${s.id}\`)`,
      );
      const text =
        lines.join('\n') +
        (list.length > maxShow ? `\n… and ${list.length - maxShow} more.` : '');
      await message.reply(`**Songs:**\n${text}\n\nUse \`${this.prefix}play <name or id>\` to play.`);
    } catch (err) {
      this.logger.warn('List songs failed', err);
      await message.reply('Failed to list songs.');
    }
  }

  private async handleListEffects(message: Message) {
    try {
      const list = await this.sounds.list('effects');
      if (list.length === 0) {
        await message.reply('No effects uploaded yet. Use the dashboard to add effects.');
        return;
      }
      const maxShow = 15;
      const lines = list.slice(0, maxShow).map(
        (s, i) => `${i + 1}. **${s.name}** (\`${s.id}\`)`,
      );
      const text =
        lines.join('\n') +
        (list.length > maxShow ? `\n… and ${list.length - maxShow} more.` : '');
      await message.reply(`**Effects:**\n${text}\n\nUse \`${this.prefix}effect <name or id>\` to trigger.`);
    } catch (err) {
      this.logger.warn('List effects failed', err);
      await message.reply('Failed to list effects.');
    }
  }
}
