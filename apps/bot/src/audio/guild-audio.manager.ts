import {
  AudioPlayerStatus,
  entersState,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { VoiceBasedChannel } from 'discord.js';
import { AudioEngine } from './audio-engine';
import { SoundCategory } from '../sound/sound.types';

interface TrackMetadata {
  id: string;
  name: string;
  filename: string;
  category: SoundCategory;
}

export class GuildAudioManager {
  private connection?: VoiceConnection;
  private readonly engine = new AudioEngine();
  private channelName?: string;
  private currentTrack?: TrackMetadata;

  constructor(private readonly guildId: string) {}

  async connect(channel: VoiceBasedChannel) {
    if (this.connection && this.connection.joinConfig.channelId === channel.id) {
      this.channelName = channel.name;
      return this.connection;
    }

    this.connection?.destroy();
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
    });
    this.channelName = channel.name;
    this.connection.subscribe(this.engine.audioPlayer);
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    return this.connection;
  }

  disconnect() {
    this.stopMusic();
    this.connection?.destroy();
    this.connection = undefined;
    this.channelName = undefined;
  }

  destroy() {
    this.stopMusic();
    this.connection?.destroy();
    this.connection = undefined;
    this.engine.destroy();
  }

  playMusic(filePath: string, metadata: TrackMetadata) {
    this.currentTrack = metadata;
    this.engine.playMusic(filePath);
  }

  stopMusic() {
    this.currentTrack = undefined;
    this.engine.stopMusic();
  }

  playEffect(filePath: string) {
    this.engine.playEffect(filePath);
  }

  get isIdle() {
    return this.engine.audioPlayer.state.status === AudioPlayerStatus.Idle;
  }

  get channelId() {
    return this.connection?.joinConfig.channelId;
  }

  get channelLabel() {
    return this.channelName;
  }

  get track() {
    return this.currentTrack;
  }

  get connected() {
    return Boolean(this.connection);
  }
}
