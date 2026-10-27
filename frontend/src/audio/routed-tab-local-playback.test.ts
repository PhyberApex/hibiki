import type { GainContextLike } from './routed-tab-local-playback'
import { describe, expect, it, vi } from 'vitest'
import { createRoutedTabLocalPlayback } from './routed-tab-local-playback'

function fakeContext(sinkId: string) {
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  const gain = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  const ctx = {
    sinkId,
    state: 'suspended' as AudioContextState,
    destination: { id: 'destination' },
    createMediaStreamSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    setSinkId: vi.fn(async () => {}),
  }
  return { ctx: ctx as unknown as GainContextLike & typeof ctx, source, gain }
}

function fakeStream() {
  const track = {
    stop: vi.fn(),
  }
  return {
    stream: {
      getTracks: () => [track],
    } as unknown as MediaStream,
    track,
  }
}

function setup(sinkId = '') {
  const fake = fakeContext(sinkId)
  const listeners = new Set<(sinkId: string) => void>()
  const unsubscribe = vi.fn()
  const deps = {
    createContext: vi.fn(() => fake.ctx),
    getSinkId: () => sinkId,
    subscribeSinkId: vi.fn((listener: (sinkId: string) => void) => {
      listeners.add(listener)
      return unsubscribe
    }),
  }
  return {
    ...fake,
    deps,
    listeners,
    unsubscribe,
  }
}

describe('createRoutedTabLocalPlayback', () => {
  it('wires capture -> gain -> destination on the Output Device and starts at the given level', async () => {
    const { deps, ctx, source, gain } = setup('usb-speaker')
    const { stream } = fakeStream()

    await createRoutedTabLocalPlayback(stream, 0.4, deps)

    expect(deps.createContext).toHaveBeenCalledWith('usb-speaker')
    expect(ctx.createMediaStreamSource).toHaveBeenCalledWith(stream)
    expect(source.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination)
    expect(gain.gain.value).toBeCloseTo(0.4)
    expect(ctx.resume).toHaveBeenCalledTimes(1)
  })

  it('tracks the level live, clamped to 0..1', async () => {
    const { deps, gain } = setup()
    const playback = await createRoutedTabLocalPlayback(fakeStream().stream, 1, deps)

    playback.setLevel(0.25)
    expect(gain.gain.value).toBeCloseTo(0.25)
    playback.setLevel(3)
    expect(gain.gain.value).toBe(1)
    playback.setLevel(-1)
    expect(gain.gain.value).toBe(0)
  })

  it('follows the Output Device while running', async () => {
    const { deps, ctx, listeners } = setup()
    await createRoutedTabLocalPlayback(fakeStream().stream, 1, deps)

    listeners.forEach(listener => listener('headphones'))

    expect(ctx.setSinkId).toHaveBeenCalledWith('headphones')
  })

  it('stop tears the graph down, releases the capture and the device subscription', async () => {
    const { deps, ctx, source, gain, unsubscribe } = setup()
    const { stream, track } = fakeStream()
    const playback = await createRoutedTabLocalPlayback(stream, 1, deps)

    playback.stop()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(source.disconnect).toHaveBeenCalledTimes(1)
    expect(gain.disconnect).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(ctx.close).toHaveBeenCalledTimes(1)
  })
})
