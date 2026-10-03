export type FadeDirection = 'in' | 'out'

export interface FadeOptions {
  direction: FadeDirection
  from: number
  to: number
  durationMs: number
  onVolume: (volume: number) => void
  onDone?: () => void
}

interface ActiveFade extends FadeOptions {
  startedAt: number
}

const TICK_MS = 50

/**
 * Drives linear volume ramps for an arbitrary set of keys, keyed by elapsed
 * wall-clock time rather than tick count, so a throttled or backgrounded
 * timer still lands on the right volume once it fires again instead of
 * drifting behind. Has no DOM/Vue dependency so it can be unit tested and
 * reused by both the Discord and local-preview playback paths.
 */
export class CrossfadeRamp {
  private fades = new Map<string, ActiveFade>()
  private timer: ReturnType<typeof setInterval> | null = null

  /**
   * Starts a fade for `key`, or retargets one already in progress. A fade
   * already heading 'out' is never redirected back to 'in' — once a sound
   * is on its way out, a later Scene switch can't resurrect it mid-fade.
   */
  fade(key: string, options: FadeOptions): void {
    if (this.fades.get(key)?.direction === 'out' && options.direction === 'in')
      return

    if (options.durationMs <= 0) {
      this.fades.delete(key)
      options.onVolume(options.to)
      options.onDone?.()
      this.stopTickingIfIdle()
      return
    }

    this.fades.set(key, { ...options, startedAt: Date.now() })
    this.ensureTicking()
  }

  directionOf(key: string): FadeDirection | null {
    return this.fades.get(key)?.direction ?? null
  }

  cancel(key: string): void {
    this.fades.delete(key)
    this.stopTickingIfIdle()
  }

  cancelAll(): void {
    this.fades.clear()
    this.stopTicking()
  }

  private ensureTicking(): void {
    if (this.timer != null)
      return
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  private stopTicking(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private stopTickingIfIdle(): void {
    if (this.fades.size === 0)
      this.stopTicking()
  }

  private tick(): void {
    const now = Date.now()
    for (const [key, fade] of [...this.fades]) {
      const progress = Math.min(1, (now - fade.startedAt) / fade.durationMs)
      fade.onVolume(fade.from + (fade.to - fade.from) * progress)
      if (progress >= 1) {
        this.fades.delete(key)
        fade.onDone?.()
      }
    }
    this.stopTickingIfIdle()
  }
}
