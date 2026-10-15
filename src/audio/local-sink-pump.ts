import type { Readable } from 'node:stream'
import { createLogger } from '../logger'
import { MIXER_PACKET_BYTES } from './mixer-feed'

const log = createLogger('local-sink')

/**
 * Where the Local Target's mix goes: the renderer, over chunked IPC (ADR-0004).
 * Packets are 48 kHz stereo signed 16-bit LE PCM, `MIXER_PACKET_BYTES` (20 ms) each.
 */
export interface LocalSink {
  start: () => void
  write: (packet: Buffer) => void
  stop: () => void
}

const PACKET_MS = 20
const TICK_MS = 10
/** Past this much lateness (a stalled main process) the pump resyncs to the clock instead of bursting out a backlog. */
const MAX_LAG_MS = 200
const SILENCE_PACKET = Buffer.alloc(MIXER_PACKET_BYTES)

/**
 * Paces the mixer output to real time and hands it to a `LocalSink`. The
 * Discord voice player does this itself by pulling a frame every 20 ms;
 * here nothing pulls, and reading eagerly would flood the renderer with
 * whatever the decoders can produce. When the mixer has nothing queued the
 * pump sends silence, so a gap on the renderer side is always a real underrun.
 */
export class LocalSinkPump {
  private timer?: ReturnType<typeof setInterval>
  private nextDue = 0
  private packetsSent = 0

  constructor(
    private readonly source: Readable,
    private readonly sink: LocalSink,
    private readonly onFailure: (err: unknown) => void,
  ) {}

  get running(): boolean {
    return this.timer !== undefined
  }

  start(): void {
    if (this.timer)
      return
    // Whatever the mixer buffered while the pump was stopped is stale.
    while (this.source.read() !== null) { /* discard */ }
    this.packetsSent = 0
    this.nextDue = Date.now()
    try {
      this.sink.start()
    }
    catch (err) {
      this.onFailure(err)
      return
    }
    log.info('Local sink pump started')
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref?.()
    this.tick()
  }

  stop(): void {
    if (!this.timer)
      return
    clearInterval(this.timer)
    this.timer = undefined
    log.info(`Local sink pump stopped after ${this.packetsSent} packets`)
    try {
      this.sink.stop()
    }
    catch (err) {
      log.error('Local sink stop failed:', err)
    }
  }

  private tick(): void {
    const now = Date.now()
    if (now - this.nextDue > MAX_LAG_MS) {
      log.warn(`Local sink pump fell ${now - this.nextDue} ms behind; resyncing`)
      this.nextDue = now
    }
    while (this.nextDue <= now && this.timer) {
      const packet = (this.source.read(MIXER_PACKET_BYTES) as Buffer | null) ?? SILENCE_PACKET
      try {
        this.sink.write(packet)
      }
      catch (err) {
        this.stop()
        this.onFailure(err)
        return
      }
      this.packetsSent++
      this.nextDue += PACKET_MS
    }
  }
}
