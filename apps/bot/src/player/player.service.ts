import { Injectable, Logger } from '@nestjs/common';
import { VoiceBasedChannel } from 'discord.js';
import { GuildAudioManager } from '../audio/guild-audio.manager';
import { SoundLibraryService } from '../sound/sound.service';
import { GuildPlaybackState } from './player.types';

@Injectable()
export class PlayerService {
  private readonly logger = new Logger(PlayerService.name);
  private readonly managers = new Map<string, GuildAudioManager>();

  constructor(private readonly sounds: SoundLibraryService) {}

  async connect(channel: VoiceBasedChannel) {
    const manager = this.getOrCreateManager(channel.guild.id);
    await manager.connect(channel);
    this.logger.log(`Connected to ${channel.guild.name}#${channel.name}`);
    return manager;
  }

  async disconnect(guildId: string) {
    const manager = this.managers.get(guildId);
    if (!manager) {
      return;
    }
    manager.disconnect();
    this.managers.delete(guildId);
    this.logger.log(`Disconnected from guild ${guildId}`);
  }

  async stop(guildId: string) {
    const manager = this.managers.get(guildId);
    if (!manager) {
      return;
    }
    manager.stopMusic();
  }

  async playMusic(guildId: string, trackId: string, channel?: VoiceBasedChannel) {
    const manager = await this.resolveManager(guildId, channel);
    const file = await this.sounds.getFile('music', trackId);
    manager.playMusic(file.path, {
      id: file.id,
      name: file.name,
      filename: file.filename,
      category: file.category,
    });
    this.logger.log(`Playing music '${file.name}' on guild ${guildId}`);
    return file;
  }

  async playEffect(guildId: string, effectId: string, channel?: VoiceBasedChannel) {
    const manager = await this.resolveManager(guildId, channel);
    const file = await this.sounds.getFile('effects', effectId);
    manager.playEffect(file.path);
    this.logger.log(`Triggered effect '${file.name}' on guild ${guildId}`);
    return file;
  }

  getState(): GuildPlaybackState[] {
    return Array.from(this.managers.entries()).map(([guildId, manager]) => ({
      guildId,
      connectedChannelId: manager.channelId,
      connectedChannelName: manager.channelLabel,
      isIdle: manager.isIdle,
      track: manager.track ?? null,
    }));
  }

  getConnectedChannelId(guildId: string) {
    return this.managers.get(guildId)?.channelId;
  }

  async resolveChannel(guildId: string, channelId: string) {
    const guild = this.managers.get(guildId)?.clientGuild ?? null;
    if (!guild) {
      throw new Error('Guild not connected');
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) {
      throw new Error('Channel not available');
    }
    return channel;
  }

  private getOrCreateManager(guildId: string) {
    if (!this.managers.has(guildId)) {
      this.managers.set(guildId, new GuildAudioManager(guildId));
    }
    return this.managers.get(guildId)!;
  }

  private async resolveManager(guildId: string, channel?: VoiceBasedChannel) {
    const manager = this.getOrCreateManager(guildId);
    if (channel) {
      await manager.connect(channel);
      return manager;
    }
    if (!manager.connected) {
      throw new Error('Hibiki is not connected to a voice channel. Use join first.');
    }
    return manager;
  }
}
