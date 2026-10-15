/**
 * Playback scheduling for the Local sink (ADR-0004). Packets are played by
 * scheduling each one on the Web Audio clock right behind the previous one;
 * the lead at which the first packet is scheduled is the jitter buffer: it
 * absorbs IPC and main-thread timing noise without an audible gap.
 */

export const SAMPLE_RATE = 48000
/** Lead the first packet (and the first one after an underrun) is scheduled with. */
export const JITTER_BUFFER_MS = 100
/** Audio queued further ahead than this is a backlog from a frozen renderer; dropping it keeps latency bounded. */
export const MAX_QUEUED_MS = 500

export type ScheduleResult
  = | { kind: 'play', startAt: number, underrun: boolean }
    | { kind: 'drop' }

export class JitterBuffer {
  private nextTime: number | null = null

  constructor(
    private readonly bufferSec = JITTER_BUFFER_MS / 1000,
    private readonly maxQueuedSec = MAX_QUEUED_MS / 1000,
  ) {}

  /** Seconds of audio scheduled but not yet played at `now`. */
  queuedSec(now: number): number {
    return this.nextTime === null ? 0 : Math.max(0, this.nextTime - now)
  }

  /**
   * Decides when a packet of `durationSec` arriving at `now` plays.
   * `underrun` is true when the previous audio ran out before this packet
   * came (never for the first packet of a run); the buffer then refills to
   * its lead before playing again.
   */
  schedule(now: number, durationSec: number): ScheduleResult {
    if (this.nextTime === null) {
      this.nextTime = now + this.bufferSec + durationSec
      return { kind: 'play', startAt: now + this.bufferSec, underrun: false }
    }
    if (this.nextTime < now) {
      this.nextTime = now + this.bufferSec + durationSec
      return { kind: 'play', startAt: now + this.bufferSec, underrun: true }
    }
    if (this.nextTime - now > this.maxQueuedSec)
      return { kind: 'drop' }
    const startAt = this.nextTime
    this.nextTime += durationSec
    return { kind: 'play', startAt, underrun: false }
  }

  /** Forgets the schedule; the next packet starts a new run with the full lead. */
  reset(): void {
    this.nextTime = null
  }
}
