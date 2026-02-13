import { PassThrough } from 'stream';
import prism from 'prism-media';
import {
  AudioPlayer,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice';
import AudioMixer, { Mixer, MixerInput } from 'audio-mixer';

interface ActiveStream {
  ffmpeg: prism.FFmpeg;
  input: MixerInput;
  loop?: boolean;
  filePath: string;
  volume: number;
}

export class AudioEngine {
  private readonly mixer: Mixer;
  private readonly output = new PassThrough();
  private readonly player: AudioPlayer;
  private readonly resource: AudioResource<null>;
  private background?: ActiveStream;

  constructor(private readonly volumes = { music: 85, effects: 90 }) {
    this.mixer = new AudioMixer.Mixer({
      channels: 2,
      bitDepth: 16,
      sampleRate: 48000,
      clearInterval: 200,
    });
    this.mixer.pipe(this.output);
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this.resource = createAudioResource<null>(this.output, {
      inputType: StreamType.Raw,
    });
    this.player.play(this.resource);
  }

  get audioPlayer() {
    return this.player;
  }

  playMusic(filePath: string) {
    this.stopBackground();
    this.background = this.spawnInput(filePath, this.volumes.music, true);
  }

  stopMusic() {
    this.stopBackground();
  }

  playEffect(filePath: string) {
    this.spawnInput(filePath, this.volumes.effects, false);
  }

  destroy() {
    this.stopBackground();
    this.player.stop(true);
    this.output.destroy();
  }

  private spawnInput(
    filePath: string,
    volume: number,
    loop: boolean,
  ): ActiveStream {
    const input = this.mixer.input({
      channels: 2,
      bitDepth: 16,
      sampleRate: 48000,
      volume,
    });
    const ffmpeg = this.createFfmpeg(filePath);
    ffmpeg.pipe(input);
    ffmpeg.once('close', () => {
      input.close();
      if (loop) {
        this.background = this.spawnInput(filePath, volume, loop);
      }
    });
    return { ffmpeg, input, loop, filePath, volume };
  }

  private createFfmpeg(filePath: string) {
    return new prism.FFmpeg({
      args: [
        '-re',
        '-i',
        filePath,
        '-analyzeduration',
        '0',
        '-loglevel',
        '0',
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
      ],
    });
  }

  private stopBackground() {
    if (!this.background) return;
    this.background.ffmpeg.removeAllListeners();
    this.background.ffmpeg.destroy();
    this.background.input.close();
    this.background = undefined;
  }
}
