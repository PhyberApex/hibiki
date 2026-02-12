declare module 'audio-mixer' {
  import { Duplex } from 'stream';

  export interface MixerOptions {
    channels?: number;
    bitDepth?: number;
    sampleRate?: number;
    clearInterval?: number;
  }

  export interface InputOptions {
    channels?: number;
    bitDepth?: number;
    sampleRate?: number;
    volume?: number;
  }

  export class Mixer extends Duplex {
    constructor(options?: MixerOptions);
    input(options?: InputOptions): MixerInput;
  }

  export class MixerInput extends Duplex {
    constructor(options?: InputOptions);
    close(): void;
  }
}
