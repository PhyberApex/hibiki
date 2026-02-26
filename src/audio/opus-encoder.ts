import { PassThrough } from 'node:stream'
import prism from 'prism-media'

export interface OpusEncoderOptions {
  sampleRate?: number // Default: 48000
  channels?: number // Default: 2
  frameSize?: number // Default: 960 (20ms @ 48kHz)
  bitrate?: number // Default: 128000
}

/**
 * Wraps prism-media's Opus encoder to convert raw PCM audio to Opus packets.
 * This eliminates the need for @discordjs/opus native module loading.
 *
 * Pipeline: Raw PCM input → Opus Encoder → Opus packets output
 */
export class OpusEncoder {
  private encoder: prism.opus.Encoder
  private inputStream: PassThrough
  private outputStream: PassThrough

  constructor(options: OpusEncoderOptions = {}) {
    const {
      sampleRate = 48000,
      channels = 2,
      frameSize = 960,
      bitrate = 128000,
    } = options

    console.warn('[OpusEncoder] Initializing encoder:', {
      sampleRate,
      channels,
      frameSize,
      bitrate,
    })

    this.inputStream = new PassThrough()
    this.outputStream = new PassThrough()

    // Create Opus encoder
    this.encoder = new prism.opus.Encoder({
      rate: sampleRate,
      channels,
      frameSize,
    })

    // ✅ CRITICAL FIX: Set bitrate using setBitrate() method (not in constructor)
    this.encoder.setBitrate(bitrate)

    // Pipe: input → encoder → output
    this.inputStream
      .pipe(this.encoder)
      .pipe(this.outputStream)

    // === Comprehensive Debug Logging ===

    // Track data flow through all stages
    this.inputStream.on('data', (chunk) => {
      console.warn('[OpusEncoder:Input] Received PCM:', chunk.length, 'bytes')
    })

    this.encoder.on('data', (chunk) => {
      console.warn('[OpusEncoder:Encoder] Produced Opus:', chunk.length, 'bytes')
    })

    this.outputStream.on('data', (chunk) => {
      console.warn('[OpusEncoder:Output] Emitting Opus:', chunk.length, 'bytes')
    })

    // Error handling for all stages
    this.inputStream.on('error', (err) => {
      console.error('[OpusEncoder:Input] Stream error:', err)
    })

    this.encoder.on('error', (err) => {
      console.error('[OpusEncoder:Encoder] Encoder error:', err)
    })

    this.outputStream.on('error', (err) => {
      console.error('[OpusEncoder:Output] Stream error:', err)
    })

    // Debug: Log first Opus packet
    let firstPacket = true
    this.outputStream.once('data', (chunk) => {
      if (firstPacket) {
        console.warn('[OpusEncoder] First Opus packet received:', chunk.length, 'bytes')
        firstPacket = false
      }
    })
  }

  /**
   * Get the input stream to write raw PCM data to
   */
  getInputStream(): PassThrough {
    return this.inputStream
  }

  /**
   * Get the output stream that emits Opus packets
   */
  getOutputStream(): PassThrough {
    return this.outputStream
  }

  /**
   * Close the encoder and clean up streams
   */
  close(): void {
    this.inputStream.end()
    this.encoder.destroy()
  }
}
