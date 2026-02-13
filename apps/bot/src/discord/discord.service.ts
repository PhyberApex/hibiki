import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  GatewayIntentBits,
  Message,
  Partials,
  VoiceBasedChannel,
} from 'discord.js';
import { PlayerService } from '../player/player.service';
import { SoundLibraryService } from '../sound/sound.service';
import { PermissionConfigService, PermissionRole } from '../permissions';

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

  getCommandRoles(guildRoleIds: string[]): Set<PermissionRole> {
    return this.permissions.getRolesForDiscordMember(guildRoleIds);
  }

  hasPermission(commandKey: string, roles: Iterable<PermissionRole>) {
    return this.permissions.hasPermission(commandKey, roles);
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

    const commandKey = `discord.${command.toLowerCase()}`;
    const memberRoleIds = Array.from(message.member?.roles.cache.keys() ?? []);
    const permissionRoles =
      this.permissions.getRolesForDiscordMember(memberRoleIds);

    if (!this.permissions.hasPermission(commandKey, permissionRoles)) {
      await message.reply('You do not have permission to run this command.');
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
      default:
        await message.reply('Unknown command.');
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
