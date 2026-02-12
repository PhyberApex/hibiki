import {
  AudioPlayerStatus,
  entersState,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { VoiceBasedChannel } from 'discord.js';
import { AudioEngine } from './audio-engine';

export class GuildAudioManager {
  private connection?: VoiceConnection;
  private readonly engine = new AudioEngine();

  constructor(private readonly guildId: string) {}

  async connect(channel: VoiceBasedChannel) {
    if (this.connection && this.connection.joinConfig.channelId === channel.id) {
      return this.connection;
    }

    this.connection?.destroy();
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
    });
    this.connection.subscribe(this.engine.audioPlayer);
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    return this.connection;
  }

  disconnect() {
    this.connection?.destroy();
    this.connection = undefined;
  }

  playMusic(filePath: string) {
    this.engine.playMusic(filePath);
  }

  stopMusic() {
    this.engine.stopMusic();
  }

  playEffect(filePath: string) {
    this.engine.playEffect(filePath);
  }

  get isIdle() {
    return this.engine.audioPlayer.state.status === AudioPlayerStatus.Idle;
  }
}
