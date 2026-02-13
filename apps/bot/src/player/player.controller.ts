import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../permissions';
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
  constructor(
    private readonly player: PlayerService,
    private readonly discord: DiscordService,
  ) {}

  @Get('state')
  @UseGuards(new PermissionGuard('player.state.view'))
  getState() {
    return this.player.getState();
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
  @UseGuards(new PermissionGuard('player.join'))
  async join(@Body() body: JoinPayload) {
    const channel = this.resolveChannel(body.guildId, body.channelId);
    await this.player.connect(channel);
    return { status: 'ok' };
  }

  @Post('leave')
  @UseGuards(new PermissionGuard('player.leave'))
  async leave(@Body('guildId') guildId: string) {
    await this.player.disconnect(guildId);
    return { status: 'ok' };
  }

  @Post('stop')
  @UseGuards(new PermissionGuard('player.stop'))
  async stop(@Body('guildId') guildId: string) {
    await this.player.stop(guildId);
    return { status: 'ok' };
  }

  @Post('play')
  @UseGuards(new PermissionGuard('player.play'))
  async play(@Body() body: PlayPayload) {
    const channel = body.channelId ? this.resolveChannel(body.guildId, body.channelId) : undefined;
    const track = await this.player.playMusic(body.guildId, body.trackId, channel);
    return { status: 'ok', track };
  }

  @Post('effect')
  @UseGuards(new PermissionGuard('player.effect'))
  async effect(@Body() body: EffectPayload) {
    const channel = body.channelId ? this.resolveChannel(body.guildId, body.channelId) : undefined;
    const effect = await this.player.playEffect(body.guildId, body.effectId, channel);
    return { status: 'ok', effect };
  }


