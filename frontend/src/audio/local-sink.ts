import { JitterBuffer, SAMPLE_RATE } from './jitter-buffer'

/**
 * The renderer end of the Local Target (ADR-0004): plays the 48 kHz stereo
 * signed 16-bit LE PCM packets the main process ships over
 * `audio:localSink*` through Web Audio, and reports its health back so a
 * dead sink shows up in hibiki.log and stops playback.
 */

export type LocalSinkHealth
  = | { type: 'started', sampleRate?: number }
    | { type: 'suspended' }
    | { type: 'resumed' }
    | { type: 'underruns', count: number }
    | { type: 'deviceLost', message?: string }
    | { type: 'failed', message?: string }

export interface SinkBufferSourceLike {
  buffer: unknown
  connect: (dest: unknown) => void
  start: (when: number) => void
}

export interface SinkAudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly sampleRate: number
  readonly destination: unknown
  onstatechange: (() => void) | null
  onerror: ((ev: unknown) => void) | null
  createBuffer: (channels: number, length: number, sampleRate: number) => { getChannelData: (c: number) => Float32Array }
  createBufferSource: () => SinkBufferSourceLike
  resume: () => Promise<void>
  close: () => Promise<void>
}

export interface LocalSinkDeps {
  createContext: () => SinkAudioContextLike
  report: (event: LocalSinkHealth) => void
  /** How often accumulated underruns are reported. */
  underrunReportMs?: number
}

const DEFAULT_UNDERRUN_REPORT_MS = 2000
const BYTES_PER_FRAME = 4

export class LocalSink {
  private ctx?: SinkAudioContextLike
  private readonly jitter = new JitterBuffer()
  private underruns = 0
  private reportTimer?: ReturnType<typeof setInterval>
  private closeTimer?: ReturnType<typeof setTimeout>
  private lastState = ''

  constructor(private readonly deps: LocalSinkDeps) {}

  get active(): boolean {
    return this.ctx !== undefined
  }

  /** `audio:localSinkStart`: nothing to prepare; the first packet opens the context (which also covers a reloaded renderer). */
  start(): void {
    this.cancelClose()
  }

  handleChunk(chunk: ArrayBuffer | ArrayBufferView): void {
    this.cancelClose()
    const ctx = this.ctx ?? this.open()
    if (!ctx)
      return
    if (ctx.state === 'suspended')
      void ctx.resume().catch(() => {})

    const bytes = chunk instanceof ArrayBuffer
      ? new Uint8Array(chunk)
      : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    const frames = Math.floor(bytes.byteLength / BYTES_PER_FRAME)
    if (frames === 0)
      return
    const view = new DataView(bytes.buffer, bytes.byteOffset, frames * BYTES_PER_FRAME)
    const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE)
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)
    for (let i = 0; i < frames; i++) {
      left[i] = view.getInt16(i * 4, true) / 32768
      right[i] = view.getInt16(i * 4 + 2, true) / 32768
    }

    const result = this.jitter.schedule(ctx.currentTime, frames / SAMPLE_RATE)
    if (result.kind === 'drop')
      return
    if (result.underrun)
      this.underruns++
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(result.startAt)
  }

  /** `audio:localSinkStop`: let what is queued play out, then release the context. */
  stop(): void {
    if (!this.ctx)
      return
    this.flushUnderruns()
    const drainMs = Math.ceil(this.jitter.queuedSec(this.ctx.currentTime) * 1000) + 50
    this.cancelClose()
    this.closeTimer = setTimeout(() => {
      this.closeTimer = undefined
      this.close()
    }, drainMs)
  }

  /** Tears everything down immediately (renderer unload). */
  dispose(): void {
    this.cancelClose()
    this.close()
  }

  private open(): SinkAudioContextLike | undefined {
    let ctx: SinkAudioContextLike
    try {
      ctx = this.deps.createContext()
    }
    catch (err) {
      this.deps.report({ type: 'failed', message: `could not create AudioContext: ${describe(err)}` })
      return undefined
    }
    this.ctx = ctx
    this.jitter.reset()
    this.underruns = 0
    this.lastState = ctx.state
    ctx.onstatechange = () => this.onStateChange(ctx)
    ctx.onerror = ev => this.onError(ev)
    this.reportTimer = setInterval(() => this.flushUnderruns(), this.deps.underrunReportMs ?? DEFAULT_UNDERRUN_REPORT_MS)
    this.deps.report({ type: 'started', sampleRate: ctx.sampleRate })
    if (ctx.state === 'suspended') {
      this.deps.report({ type: 'suspended' })
      void ctx.resume().catch(() => {})
    }
    return ctx
  }

  private onStateChange(ctx: SinkAudioContextLike): void {
    if (ctx !== this.ctx)
      return
    const state = ctx.state
    if (state === this.lastState)
      return
    const previous = this.lastState
    this.lastState = state
    if (state === 'closed') {
      // Not our own close(): that detaches this handler first.
      this.deps.report({ type: 'failed', message: 'AudioContext was closed' })
      this.release()
    }
    else if (state === 'running' && previous !== 'running') {
      // Audio scheduled while suspended is stale: restart the run with a fresh lead.
      this.jitter.reset()
      this.deps.report({ type: 'resumed' })
    }
    else if (state !== 'running') {
      this.deps.report({ type: 'suspended' })
    }
  }

  private onError(ev: unknown): void {
    this.deps.report({ type: 'deviceLost', message: describe(ev) })
    this.release()
  }

  private flushUnderruns(): void {
    if (this.underruns === 0)
      return
    const count = this.underruns
    this.underruns = 0
    this.deps.report({ type: 'underruns', count })
  }

  private cancelClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
      this.closeTimer = undefined
    }
  }

  private close(): void {
    const ctx = this.ctx
    this.release()
    if (ctx)
      void ctx.close().catch(() => {})
  }

  /** Forgets the context without closing it (it is already closed or unusable), after detaching its handlers. */
  private release(): void {
    if (this.ctx) {
      this.ctx.onstatechange = null
      this.ctx.onerror = null
    }
    this.ctx = undefined
    if (this.reportTimer) {
      clearInterval(this.reportTimer)
      this.reportTimer = undefined
    }
    this.cancelClose()
    this.jitter.reset()
  }
}

function describe(err: unknown): string {
  if (err instanceof Error)
    return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
    return (err as { message: string }).message
  return String(err ?? 'unknown')
}

/** Wires a `LocalSink` to the `audio:localSink*` IPC channels and reports health through the player API. Returns an unsubscribe. */
export function installLocalSink(): () => void {
  const hibiki = window.hibiki
  if (!hibiki?.on || !hibiki.invoke)
    return () => {}
  const sink = new LocalSink({
    createContext: () => new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' }) as unknown as SinkAudioContextLike,
    report: (event) => {
      if (event.type === 'failed' || event.type === 'deviceLost')
        console.error(`[local-sink] ${event.type}${'message' in event && event.message ? `: ${event.message}` : ''}`)
      void hibiki.invoke('api', { domain: 'player', method: 'reportLocalSinkHealth', args: [event] }).catch((err) => {
        console.warn('[local-sink] could not report sink health:', err)
      })
    },
  })
  const offs = [
    hibiki.on('audio:localSinkStart', () => sink.start()),
    hibiki.on('audio:localSinkChunk', chunk => sink.handleChunk(chunk as ArrayBuffer | ArrayBufferView)),
    hibiki.on('audio:localSinkStop', () => sink.stop()),
  ]
  return () => {
    offs.forEach(off => off())
    sink.dispose()
  }
}
