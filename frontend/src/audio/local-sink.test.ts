import type { LocalSinkHealth, SinkAudioContextLike } from './local-sink'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportLocalSinkHealth } from '../api/player'
import { useToastStore } from '../stores/toast'
import { installLocalSink, LocalSink, sinkDeathToast } from './local-sink'
import { outputDeviceRouter } from './output-device'

vi.mock('../api/player', () => ({
  reportLocalSinkHealth: vi.fn(),
}))
vi.mock('../stores/toast', () => {
  const toast = {
    show: vi.fn(),
  }
  return {
    useToastStore: () => toast,
  }
})

function packet(sample: number, frames = 960): Uint8Array {
  const bytes = new Uint8Array(frames * 4)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < frames; i++) {
    view.setInt16(i * 4, sample, true)
    view.setInt16(i * 4 + 2, -sample, true)
  }
  return bytes
}

function fakeContext() {
  const started: Array<{ when: number, buffer: { left: Float32Array, right: Float32Array } }> = []
  const ctx = {
    currentTime: 0,
    state: 'running',
    sampleRate: 48000,
    destination: {},
    onstatechange: null as (() => void) | null,
    onerror: null as ((ev: unknown) => void) | null,
    createBuffer: (_c: number, length: number) => {
      const left = new Float32Array(length)
      const right = new Float32Array(length)
      return {
        left,
        right,
        getChannelData: (c: number) => (c === 0
          ? left
          : right),
      }
    },
    createBufferSource: () => {
      const source = {
        buffer: undefined as unknown,
        connect: vi.fn(),
        start: (when: number) => started.push({ when, buffer: source.buffer as { left: Float32Array, right: Float32Array } }),
      }
      return source
    },
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
  return { ctx: ctx as typeof ctx & SinkAudioContextLike, started }
}

function setup() {
  const fake = fakeContext()
  const events: LocalSinkHealth[] = []
  const createContext = vi.fn(() => fake.ctx)
  const sink = new LocalSink({
    createContext,
    report: e => events.push(e),
    underrunReportMs: 1000,
  })
  return { ...fake, events, sink, createContext }
}

describe('localSink', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens the context on the first packet, reports started and decodes s16 stereo', () => {
    const { sink, events, started, createContext } = setup()
    expect(createContext).not.toHaveBeenCalled()
    sink.handleChunk(packet(16384))
    expect(events).toEqual([
      { type: 'started', sampleRate: 48000 },
    ])
    expect(started).toHaveLength(1)
    expect(started[0].when).toBeCloseTo(0.1)
    expect(started[0].buffer.left[0]).toBeCloseTo(0.5)
    expect(started[0].buffer.right[0]).toBeCloseTo(-0.5)
    sink.handleChunk(packet(0))
    expect(createContext).toHaveBeenCalledTimes(1)
  })

  it('accepts typed-array views with an offset', () => {
    const { sink, started } = setup()
    const backing = new Uint8Array(8 + 3840)
    backing.set(packet(8192), 8)
    sink.handleChunk(backing.subarray(8))
    expect(started[0].buffer.left[0]).toBeCloseTo(0.25)
  })

  it('reports accumulated underruns periodically, not per event', () => {
    const { sink, ctx, events } = setup()
    sink.handleChunk(packet(1))
    ctx.currentTime = 5
    sink.handleChunk(packet(1))
    ctx.currentTime = 10
    sink.handleChunk(packet(1))
    expect(events.filter(e => e.type === 'underruns')).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    expect(events.filter(e => e.type === 'underruns')).toEqual([
      { type: 'underruns', count: 2 },
    ])
    vi.advanceTimersByTime(5000)
    expect(events.filter(e => e.type === 'underruns')).toHaveLength(1)
  })

  it('reports suspend and resume of the AudioContext', () => {
    const { sink, ctx, events } = setup()
    sink.handleChunk(packet(1))
    ctx.state = 'suspended'
    ctx.onstatechange?.()
    ctx.state = 'running'
    ctx.onstatechange?.()
    expect(events.map(e => e.type)).toEqual(['started', 'suspended', 'resumed'])
  })

  it('tries to resume a context that starts suspended', () => {
    const { sink, ctx, events } = setup()
    ctx.state = 'suspended'
    sink.handleChunk(packet(1))
    expect(events.map(e => e.type)).toEqual(['started', 'suspended'])
    expect(ctx.resume).toHaveBeenCalled()
  })

  it('reports failure when the context is closed from under it, and reopens on the next packet', () => {
    const { sink, ctx, events, createContext } = setup()
    sink.handleChunk(packet(1))
    ctx.state = 'closed'
    ctx.onstatechange?.()
    expect(events.at(-1)).toMatchObject({ type: 'failed' })
    expect(sink.active).toBe(false)
    ctx.state = 'running'
    sink.start()
    sink.handleChunk(packet(1))
    expect(createContext).toHaveBeenCalledTimes(2)
  })

  it('ignores late packets after a failure until the next start', () => {
    const { sink, ctx, createContext } = setup()
    sink.handleChunk(packet(1))
    ctx.state = 'closed'
    ctx.onstatechange?.()
    ctx.state = 'running'
    sink.handleChunk(packet(1))
    expect(createContext).toHaveBeenCalledTimes(1)
    sink.start()
    sink.handleChunk(packet(1))
    expect(createContext).toHaveBeenCalledTimes(2)
  })

  it('treats a context that stays suspended as failed', () => {
    const { sink, ctx, events } = setup()
    sink.handleChunk(packet(1))
    ctx.state = 'suspended'
    ctx.onstatechange?.()
    vi.advanceTimersByTime(5000)
    expect(events.at(-1)).toMatchObject({ type: 'failed' })
    expect(sink.active).toBe(false)
  })

  it('does not fail a context that resumes in time', () => {
    const { sink, ctx, events } = setup()
    sink.handleChunk(packet(1))
    ctx.state = 'suspended'
    ctx.onstatechange?.()
    vi.advanceTimersByTime(2000)
    ctx.state = 'running'
    ctx.onstatechange?.()
    vi.advanceTimersByTime(10000)
    expect(events.some(e => e.type === 'failed')).toBe(false)
  })

  it('reports a lost device', () => {
    const { sink, ctx, events } = setup()
    sink.handleChunk(packet(1))
    ctx.onerror?.({ message: 'device unplugged' })
    expect(events.at(-1)).toEqual({ type: 'deviceLost', message: 'device unplugged' })
    expect(sink.active).toBe(false)
  })

  it('reports failure when the AudioContext cannot be created', () => {
    const events: LocalSinkHealth[] = []
    const sink = new LocalSink({
      createContext: () => {
        throw new Error('no audio device')
      },
      report: e => events.push(e),
    })
    sink.handleChunk(packet(1))
    expect(events).toEqual([
      { type: 'failed', message: 'could not create AudioContext: no audio device' },
    ])
  })

  it('drains on stop: closes the context only after the queued audio has played', () => {
    const { sink, ctx } = setup()
    sink.handleChunk(packet(1))
    sink.stop()
    vi.advanceTimersByTime(100)
    expect(ctx.close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(ctx.close).toHaveBeenCalledTimes(1)
    expect(sink.active).toBe(false)
  })

  it('keeps playing when packets arrive during the drain', () => {
    const { sink, ctx } = setup()
    sink.handleChunk(packet(1))
    sink.stop()
    sink.handleChunk(packet(1))
    vi.advanceTimersByTime(1000)
    expect(ctx.close).not.toHaveBeenCalled()
    expect(sink.active).toBe(true)
  })

  it('does not report failure for its own close', () => {
    const { sink, ctx, events } = setup()
    sink.handleChunk(packet(1))
    sink.dispose()
    ctx.state = 'closed'
    ctx.onstatechange?.()
    expect(events.map(e => e.type)).toEqual(['started'])
  })

  it('opens the context with the resolved sink id', () => {
    const fake = fakeContext()
    const createContext = vi.fn((_sinkId: string) => fake.ctx)
    const sink = new LocalSink({
      createContext,
      getSinkId: () => 'usb-speaker',
      report: () => {},
    })
    sink.handleChunk(packet(1))
    expect(createContext).toHaveBeenCalledWith('usb-speaker')
  })

  it('opens on the system default when no sink id is resolved', () => {
    const { sink, createContext } = setup()
    sink.handleChunk(packet(1))
    expect(createContext).toHaveBeenCalledWith('')
  })

  it('switches a running context with setSinkId, and ignores a closed sink', () => {
    const { sink, ctx } = setup()
    const setSinkId = vi.fn(async () => {})
    ;(ctx as { setSinkId?: unknown }).setSinkId = setSinkId
    sink.setSinkId('x')
    expect(setSinkId).not.toHaveBeenCalled()
    sink.handleChunk(packet(1))
    sink.setSinkId('x')
    expect(setSinkId).toHaveBeenCalledWith('x')
  })

  it('names the reason and Settings in the sink death toast', () => {
    expect(sinkDeathToast({ type: 'deviceLost', message: 'device unplugged' }))
      .toBe('Local playback stopped: device unplugged. Pick an Output Device in Settings.')
    expect(sinkDeathToast({ type: 'failed' })).toContain('failed')
  })
})

describe('installLocalSink', () => {
  type Listener = (payload?: unknown) => void
  let listeners: Map<string, Listener>
  let offs: Array<ReturnType<typeof vi.fn>>
  let fake: ReturnType<typeof fakeContext>
  let contextOptions: unknown[]

  let uninstalls: Array<() => void>

  /** Installs the sink and uninstalls it after the test, so no sink stays subscribed to the shared router. */
  function install() {
    const uninstall = installLocalSink()
    uninstalls.push(uninstall)
    return uninstall
  }

  function emit(channel: string, payload?: unknown) {
    listeners.get(channel)?.(payload)
  }

  beforeEach(() => {
    listeners = new Map()
    uninstalls = []
    offs = []
    fake = fakeContext()
    contextOptions = []
    ;(window as any).hibiki = {
      invoke: vi.fn(),
      on: vi.fn((channel: string, listener: Listener) => {
        listeners.set(channel, listener)
        const off = vi.fn()
        offs.push(off)
        return off
      }),
    }
    vi.stubGlobal('AudioContext', class {
      constructor(options: unknown) {
        contextOptions.push(options)
        return fake.ctx as any
      }
    })
    vi.mocked(reportLocalSinkHealth).mockResolvedValue(undefined)
  })
  afterEach(() => {
    uninstalls.forEach(uninstall => uninstall())
    vi.useRealTimers()
    delete (window as any).hibiki
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('is a no-op outside Electron', () => {
    delete (window as any).hibiki
    expect(() => installLocalSink()()).not.toThrow()
  })

  it('plays packets from audio:localSinkChunk and reports started through the player API', () => {
    install()
    emit('audio:localSinkStart')
    emit('audio:localSinkChunk', packet(1))
    expect(fake.started).toHaveLength(1)
    expect(contextOptions).toEqual([
      { sampleRate: 48000, latencyHint: 'interactive' },
    ])
    expect(reportLocalSinkHealth).toHaveBeenCalledWith({ type: 'started', sampleRate: 48000 })
  })

  it('reports deviceLost, toasts the reason, and stops scheduling', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    install()
    emit('audio:localSinkChunk', packet(1))
    fake.ctx.onerror?.({ message: 'device unplugged' })
    expect(reportLocalSinkHealth).toHaveBeenLastCalledWith({ type: 'deviceLost', message: 'device unplugged' })
    expect(error).toHaveBeenCalledWith('[local-sink] deviceLost: device unplugged')
    expect(useToastStore().show).toHaveBeenCalledWith({
      type: 'error',
      text: sinkDeathToast({ type: 'deviceLost', message: 'device unplugged' }),
    })
    expect(fake.ctx.close).toHaveBeenCalled()
    emit('audio:localSinkChunk', packet(1))
    expect(fake.started).toHaveLength(1)
  })

  it('reports failed, toasts the reason, and stops scheduling', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    install()
    emit('audio:localSinkChunk', packet(1))
    fake.ctx.state = 'closed'
    fake.ctx.onstatechange?.()
    expect(reportLocalSinkHealth).toHaveBeenLastCalledWith({ type: 'failed', message: 'AudioContext was closed' })
    expect(useToastStore().show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    fake.ctx.state = 'running'
    emit('audio:localSinkChunk', packet(1))
    expect(fake.started).toHaveLength(1)
  })

  it('logs a health report that could not be delivered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(reportLocalSinkHealth).mockRejectedValue(new Error('ipc down'))
    install()
    emit('audio:localSinkChunk', packet(1))
    await flushPromises()
    expect(warn).toHaveBeenCalledWith('[local-sink] could not report sink health:', expect.any(Error))
  })

  it('opens on the resolved Output Device and follows its changes', () => {
    const setSinkId = vi.fn(async () => {})
    ;(fake.ctx as { setSinkId?: unknown }).setSinkId = setSinkId
    vi.spyOn(outputDeviceRouter, 'sinkId', 'get').mockReturnValue('usb')
    const subscribe = vi.spyOn(outputDeviceRouter, 'subscribe')
    install()
    emit('audio:localSinkChunk', packet(1))
    expect(contextOptions).toEqual([
      { sampleRate: 48000, latencyHint: 'interactive', sinkId: 'usb' },
    ])
    subscribe.mock.calls[0][0]('builtin')
    expect(setSinkId).toHaveBeenCalledWith('builtin')
  })

  it('drains on audio:localSinkStop', () => {
    vi.useFakeTimers()
    install()
    emit('audio:localSinkChunk', packet(1))
    emit('audio:localSinkStop')
    vi.advanceTimersByTime(1000)
    expect(fake.ctx.close).toHaveBeenCalledOnce()
  })

  it('unsubscribes every channel and disposes the sink on uninstall', () => {
    const uninstall = install()
    emit('audio:localSinkChunk', packet(1))
    uninstall()
    expect(offs).toHaveLength(3)
    offs.forEach(off => expect(off).toHaveBeenCalledOnce())
    expect(fake.ctx.close).toHaveBeenCalledOnce()
  })
})
