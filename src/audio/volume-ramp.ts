export interface RampOptions {
  from: number
  to: number
  durationMs: number
  onVolume: (volume: number) => void
  onDone?: () => void
}

export interface RampHandle {
  cancel: () => void
}

const TICK_MS = 50

/**
 * Drives a single linear volume ramp from `from` to `to`, ticking on
 * wall-clock elapsed time (not tick count) so a throttled timer still lands
 * on `to` once it fires again instead of drifting behind. A duration of 0
 * (or less) applies `to` immediately and synchronously.
 */
export function rampVolume(options: RampOptions): RampHandle {
  if (options.durationMs <= 0) {
    options.onVolume(options.to)
    options.onDone?.()
    return { cancel: () => {} }
  }

  const startedAt = Date.now()
  const timer: ReturnType<typeof setInterval> = setInterval(() => {
    const progress = Math.min(1, (Date.now() - startedAt) / options.durationMs)
    options.onVolume(options.from + (options.to - options.from) * progress)
    if (progress >= 1) {
      clearInterval(timer)
      options.onDone?.()
    }
  }, TICK_MS)

  return {
    cancel: () => clearInterval(timer),
  }
}
