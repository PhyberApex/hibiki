import type {
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import type { Message, VoiceBasedChannel } from 'discord.js'
import { REST } from '@discordjs/rest'
import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config' // eslint-disable-line ts/consistent-type-imports
import { Routes } from 'discord-api-types/v10'
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js'
import { PermissionConfigService } from '../permissions' // eslint-disable-line ts/consistent-type-imports
import { PlayerService } from '../player/player.service'
import { SoundLibraryService } from '../sound/sound.service' // eslint-disable-line ts/consistent-type-imports
import { DiscordCommandHandler } from './discord-commands.handler'
import { DiscordInteractionHandler } from './discord-interactions.handler'
import { getSlashCommandsJSON } from './discord-slash.commands'
import { DiscordSlashHandler } from './discord-slash.handler'

export interface GuildDirectoryEntry {
  guildId: string
  guildName: string
  channels: { id: string, name: string }[]
}

@Injectable()
export class DiscordService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name)
  private readonly client: Client
  private readonly prefix: string
  private readonly e2eAllowBotId: string | undefined
  private readonly commandHandler: DiscordCommandHandler
  private readonly interactionHandler: DiscordInteractionHandler
  private readonly slashHandler: DiscordSlashHandler

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => PlayerService))
    private readonly player: PlayerService,
    private readonly sounds: SoundLibraryService,
    private readonly permissions: PermissionConfigService,
  ) {
    this.prefix = this.config.get<string>('discord.commandPrefix', '!')
    this.e2eAllowBotId = this.config.get<string>('discord.e2eAllowBotId')
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    })

    this.commandHandler = new DiscordCommandHandler({
      player: this.player,
      sounds: this.sounds,
      prefix: this.prefix,
      logger: this.logger,
      getBotId: () => this.client.user?.id,
    })

    this.interactionHandler = new DiscordInteractionHandler({
      player: this.player,
      sounds: this.sounds,
      client: this.client,
      listGuildDirectory: () => this.listGuildDirectory(),
    })

    this.slashHandler = new DiscordSlashHandler({
      player: this.player,
      sounds: this.sounds,
      listGuildDirectory: () => this.listGuildDirectory(),
      getBotId: () => this.client.user?.id,
    })
  }

  async onModuleInit() {
    const token = this.config.get<string>('discord.token')
    if (!token) {
      this.logger.warn(
        'No Discord token configured. Skipping Discord client login.',
      )
      return
    }

    this.client.once(Events.ClientReady, async () => {
      this.logger.log(`Logged in as ${this.client.user?.tag}`)
      await this.registerSlashCommands()
    })

    this.client.on('messageCreate', (message) => {
      void this.handleMessage(message)
    })

    this.client.on('interactionCreate', (interaction) => {
      void this.handleInteraction(interaction)
    })

    try {
      await this.client.login(token)
    }
    catch (error) {
      this.logger.error('Failed to login to Discord', error as Error)
    }
  }

  async onModuleDestroy() {
    if (this.client.isReady()) {
      await this.client.destroy()
    }
  }

  getClient() {
    return this.client
  }

  /**
   * Asks Discord to leave the voice channel in this guild (REST API).
   * Use when there is no in-process VoiceConnection (e.g. after bot restart)
   * but Discord still shows the bot in a channel.
   */
  async leaveVoiceChannel(guildId: string): Promise<boolean> {
    if (!this.client.isReady()) {
      this.logger.debug(`leaveVoiceChannel ${guildId}: client not ready`)
      return false
    }
    const guild = this.client.guilds.cache.get(guildId)
    if (!guild) {
      this.logger.debug(`leaveVoiceChannel ${guildId}: guild not in cache`)
      return false
    }
    const me = guild.members.me
    const voice = me?.voice
    if (!voice?.channelId) {
      this.logger.debug(`leaveVoiceChannel ${guildId}: bot not in a voice channel (channelId=${voice?.channelId ?? 'none'})`)
      return false
    }
    try {
      await voice.setChannel(null)
      this.logger.log(`Left voice channel via API for guild ${guildId}`)
      return true
    }
    catch (err) {
      this.logger.warn(`leaveVoiceChannel ${guildId} failed: ${err instanceof Error ? err.message : err}`)
      return false
    }
  }

  /**
   * Returns the bot's current voice state in a guild (from Discord).
   * Use this to correct persisted state after a crash — if the bot is no longer
   * in a channel, Discord will report null.
   */
  getBotVoiceStateForGuild(guildId: string): { channelId: string | null, channelName: string | null } {
    if (!this.client.isReady()) {
      return { channelId: null, channelName: null }
    }
    const guild = this.client.guilds.cache.get(guildId)
    const voice = guild?.members.me?.voice
    const channelId = voice?.channelId ?? voice?.channel?.id ?? null
    const channelName = voice?.channel?.name ?? null
    return { channelId, channelName }
  }

  /**
   * Client connected and ready to join/play.
   */
  getBotStatus(): { ready: boolean, userTag?: string, userId?: string } {
    if (!this.client.isReady()) {
      return { ready: false }
    }
    const tag = this.client.user?.tag
    const userId = this.client.user?.id
    return { ready: true, userTag: tag ?? undefined, userId: userId ?? undefined }
  }

  /**
   * Lists all guilds and their voice channels.
   */
  listGuildDirectory(): GuildDirectoryEntry[] {
    if (!this.client.isReady()) {
      return []
    }

    return this.client.guilds.cache.map(guild => ({
      guildId: guild.id,
      guildName: guild.name,
      channels: guild.channels.cache
        .filter((channel): channel is VoiceBasedChannel =>
          channel.isVoiceBased(),
        )
        .map(channel => ({
          id: channel.id,
          name: channel.name ?? channel.id,
        })),
    }))
  }

  /**
   * Handles incoming Discord messages with command prefix (for !join, !play, etc.).
   * Kept alongside slash commands so E2E can drive the same logic via prefix.
   */
  private async handleMessage(message: Message): Promise<void> {
    const isAllowedE2EBot = this.e2eAllowBotId && message.author.id === this.e2eAllowBotId
    if (!this.client.isReady() || (!isAllowedE2EBot && message.author.bot) || !message.inGuild()) {
      return
    }

    if (!message.guild) {
      return
    }

    const content = message.content ?? ''
    if (!content.startsWith(this.prefix)) {
      return
    }

    const [command, ...args] = content
      .slice(this.prefix.length)
      .trim()
      .split(/\s+/)
    if (!command) {
      this.logger.debug(
        `Prefix received but no command (content may be empty). Enable "Message Content Intent" in Developer Portal → Bot if commands are ignored.`,
      )
      return
    }

    this.logger.log(
      `Command '${command}' from ${message.author.tag} in ${message.guild.name}`,
    )

    const memberRoleIds = Array.from(message.member?.roles.cache.keys() ?? [])
    const userId = message.author?.id ?? null
    if (!this.permissions.isAllowed(memberRoleIds, userId)) {
      await message.reply('You are not allowed to use this bot.')
      return
    }

    switch (command.toLowerCase()) {
      case 'join':
        await this.commandHandler.handleJoin(message)
        break
      case 'leave':
        await this.commandHandler.handleLeave(message)
        break
      case 'stop':
        await this.commandHandler.handleStop(message)
        break
      case 'play':
        await this.commandHandler.handlePlayMusic(message, args)
        break
      case 'effect':
        await this.commandHandler.handlePlayEffect(message, args)
        break
      case 'songs':
        await this.commandHandler.handleListSongs(message)
        break
      case 'effects':
        await this.commandHandler.handleListEffects(message)
        break
      case 'menu':
      case 'panel':
        await this.commandHandler.handleMenuCommand(message)
        break
      case 'help':
        await this.commandHandler.handleHelp(message)
        break
      case 'volume':
        await this.commandHandler.handleVolume(message, args)
        break
      case 'delete':
        await this.commandHandler.handleDelete(message)
        break
      default:
        await message.reply('Unknown command.')
    }
  }

  /**
   * Registers slash commands with Discord (global or guild).
   */
  private async registerSlashCommands(): Promise<void> {
    const token = this.config.get<string>('discord.token')
    const clientId = this.config.get<string>('discord.clientId')
    const defaultGuildId = this.config.get<string>('discord.defaultGuildId')

    if (!token || !clientId) {
      this.logger.warn('Cannot register slash commands: missing discord.token or discord.clientId')
      return
    }

    try {
      const rest = new REST().setToken(token)
      const body = getSlashCommandsJSON()
      if (defaultGuildId) {
        await rest.put(Routes.applicationGuildCommands(clientId, defaultGuildId), { body })
        this.logger.log(`Registered ${(body as unknown[]).length} slash commands in guild ${defaultGuildId}`)
      }
      else {
        await rest.put(Routes.applicationCommands(clientId), { body })
        this.logger.log(`Registered ${(body as unknown[]).length} slash commands globally`)
      }
    }
    catch (err) {
      this.logger.error('Failed to register slash commands', err as Error)
    }
  }

  /**
   * Handles Discord slash commands, button and select menu interactions.
   */
  private async handleInteraction(interaction: import('discord.js').Interaction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild)
      return

    const memberRoleIds = this.getMemberRoleIds(interaction)
    const userId = this.getUserId(interaction)
    if (!this.permissions.isAllowed(memberRoleIds, userId)) {
      const canReply = interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChatInputCommand()
      if (canReply) {
        await interaction.reply({
          content: 'You are not allowed to use this bot.',
          ephemeral: true,
        }).catch(() => {})
      }
      return
    }

    if (interaction.isChatInputCommand()) {
      await this.slashHandler.handle(interaction)
      return
    }

    if (interaction.isButton()) {
      await this.interactionHandler.handlePanelButton(interaction)
      return
    }

    if (interaction.isStringSelectMenu()) {
      await this.interactionHandler.handleSelectMenu(interaction)
    }
  }

  private getMemberRoleIds(interaction: import('discord.js').Interaction): string[] {
    const member = interaction.member
    if (!member?.roles)
      return []
    return member.roles && 'cache' in member.roles
      ? Array.from((member.roles as { cache: Map<string, unknown> }).cache.keys())
      : Array.isArray(member.roles)
        ? (member.roles as string[])
        : []
  }

  private getUserId(interaction: import('discord.js').Interaction): string | null {
    const user = interaction.user ?? (interaction.member as { user?: { id?: string } } | null)?.user
    return user?.id ?? null
  }
}
