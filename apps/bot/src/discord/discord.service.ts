import type {
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import type {
  ButtonInteraction,
  Message,
  StringSelectMenuInteraction,
  VoiceBasedChannel,
} from 'discord.js'
import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config' // eslint-disable-line ts/consistent-type-imports
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

    // Initialize handlers
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
  }

  async onModuleInit() {
    const token = this.config.get<string>('discord.token')
    if (!token) {
      this.logger.warn(
        'No Discord token configured. Skipping Discord client login.',
      )
      return
    }

    this.client.once(Events.ClientReady, () => {
      this.logger.log(`Logged in as ${this.client.user?.tag}`)
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
   * Handles incoming Discord messages with command prefix.
   */
  private async handleMessage(message: Message) {
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

    // Delegate to command handler
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
   * Handles Discord button and select menu interactions.
   */
  private async handleInteraction(interaction: import('discord.js').Interaction) {
    if (!interaction.inGuild() || !interaction.guild)
      return

    const i = interaction as ButtonInteraction | StringSelectMenuInteraction
    const memberRoleIds = this.interactionHandler.getMemberRoleIds(i)
    const userId = this.interactionHandler.getUserId(i)

    if (!this.permissions.isAllowed(memberRoleIds, userId)) {
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        await interaction.reply({
          content: 'You are not allowed to use this bot.',
          ephemeral: true,
        }).catch(() => {})
      }
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
}
