import { outputDeviceRouter } from './output-device'

/** The slice of `AudioContext` the Local replay of a Routed Tab uses, narrow enough to fake in tests. */
export interface GainContextLike {
  state: AudioContextState
  destination: AudioNode
  createMediaStreamSource: (stream: MediaStream) => AudioNode
  createGain: () => GainNode
  resume: () => Promise<void>
  close: () => Promise<void>
  setSinkId?: (sinkId: string) => Promise<void>
}

export interface RoutedTabLocalPlaybackDeps {
  createContext: (sinkId: string) => GainContextLike
  getSinkId: () => string
  subscribeSinkId: (listener: (sinkId: string) => void) => () => void
}

export interface RoutedTabLocalPlayback {
  /** Sets the gain (0–1), applied instantly. */
  setLevel: (level: number) => void
  /** Tears the graph down, closes the context and stops the captured tracks. */
  stop: () => void
}

const defaultDeps: RoutedTabLocalPlaybackDeps = {
  createContext: sinkId => new AudioContext({ latencyHint: 'interactive', ...(sinkId ? { sinkId } : {}) }) as unknown as GainContextLike,
  getSinkId: () => outputDeviceRouter.sinkId,
  subscribeSinkId: listener => outputDeviceRouter.subscribe(listener),
}

function clampLevel(level: number): number {
  return Math.min(1, Math.max(0, level))
}

/**
 * Plays a tab-capture `MediaStream` through a gain node on the Output Device
 * (ADR-0007: a Routed Tab under the Local Target is muted in its view and
 * replayed from its capture at Tab Volume × master). The gain follows
 * `setLevel`; the sink follows the Output Device router like the Local sink.
 */
export async function createRoutedTabLocalPlayback(
  stream: MediaStream,
  initialLevel: number,
  deps: RoutedTabLocalPlaybackDeps = defaultDeps,
): Promise<RoutedTabLocalPlayback> {
  const ctx = deps.createContext(deps.getSinkId())
  const source = ctx.createMediaStreamSource(stream)
  const gain = ctx.createGain()
  gain.gain.value = clampLevel(initialLevel)
  source.connect(gain)
  gain.connect(ctx.destination)

  const unsubscribe = deps.subscribeSinkId((sinkId) => {
    if (!ctx.setSinkId)
      return
    ctx.setSinkId(sinkId).catch((err) => {
      console.warn('[browser] could not move a Routed Tab to the Output Device:', err)
    })
  })

  if (ctx.state === 'suspended')
    await ctx.resume()

  return {
    setLevel: (level) => {
      gain.gain.value = clampLevel(level)
    },
    stop: () => {
      unsubscribe()
      source.disconnect()
      gain.disconnect()
      stream.getTracks().forEach(track => track.stop())
      ctx.close().catch(() => {})
    },
  }
}
