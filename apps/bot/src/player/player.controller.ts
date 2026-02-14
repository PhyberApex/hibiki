import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import { PlayerService } from './player.service';
import { DiscordService } from '../discord/discord.service';

interface JoinPayload {
  guildId: string;
  channelId: string;
}

interface PlayPayload {
  guildId: string;
  trackId: string;
  channelId?: string;
}

interface EffectPayload {
  guildId: string;
  effectId: string;
  channelId?: string;
}

@Controller('player')
export class PlayerController {
  private readonly logger = new Logger(PlayerController.name);

  constructor(
    private readonly player: PlayerService,
    private readonly discord: DiscordService,
  ) {}

  @Get('state')
  async getState() {
    this.logger.log('GET /player/state');
    return this.player.getState();
  }

  @Get('bot-status')
  getBotStatus() {
    this.logger.debug('GET /player/bot-status');
    return this.discord.getBotStatus();
  }

  @Get('guilds')
  getGuildDirectory() {
    this.logger.log('GET /player/guilds');
    return this.discord.listGuildDirectory();
  }

  private resolveChannel(guildId: string, channelId?: string) {
    const client = this.discord.getClient();
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error('Guild not available on bot');
    }
    if (!channelId) {
      throw new Error('Channel ID required');
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) {
      throw new Error('Channel not found or not voice-based');
    }
    return channel;
  }

  @Post('join')
  async join(@Body() body: JoinPayload) {
    this.logger.log(`POST /player/join guild=${body.guildId} channel=${body.channelId}`);
    const channel = this.resolveChannel(body.guildId, body.channelId);
    await this.player.connect(channel);
    return { status: 'ok' };
  }

  @Post('leave')
  async leave(@Body('guildId') guildId: string) {
    this.logger.log(`POST /player/leave guild=${guildId}`);
    await this.player.disconnect(guildId);
    return { status: 'ok' };
  }

  @Post('stop')
  async stop(@Body('guildId') guildId: string) {
    this.logger.log(`POST /player/stop guild=${guildId}`);
    await this.player.stop(guildId);
    return { status: 'ok' };
  }

  @Post('play')
  async play(@Body() body: PlayPayload) {
    this.logger.log(`POST /player/play guild=${body.guildId} track=${body.trackId} channel=${body.channelId ?? 'current'}`);
    const channel = body.channelId
      ? this.resolveChannel(body.guildId, body.channelId)
      : undefined;
    const track = await this.player.playMusic(
      body.guildId,
      body.trackId,
      channel,
    );
    return { status: 'ok', track };
  }

  @Post('effect')
  async effect(@Body() body: EffectPayload) {
    this.logger.log(`POST /player/effect guild=${body.guildId} effect=${body.effectId} channel=${body.channelId ?? 'current'}`);
    const channel = body.channelId
      ? this.resolveChannel(body.guildId, body.channelId)
      : undefined;
    const effect = await this.player.playEffect(
      body.guildId,
      body.effectId,
      channel,
    );
    return { status: 'ok', effect };
  }
}
