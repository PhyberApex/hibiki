/**
 * Captures audio from browser sources (HTML5 audio element or tab/window via getDisplayMedia)
 * and converts to 48kHz stereo s16le PCM for Discord.
 *
 * Uses AudioWorkletNode (replaces deprecated ScriptProcessorNode).
 */

import { logInfo } from './audio-element-diagnostics'
import { outputDeviceRouter } from './output-device'

const SAMPLE_RATE = 48000
const CHANNELS = 2
const BUFFER_SIZE = 4096

export type AudioChunkCallback = (chunk: ArrayBuffer) => void

export interface CaptureSession {
  stop: () => void
}

function float32ToInt16(float32: Float32Array): ArrayBuffer {
  const len = float32.length
  const int16 = new Int16Array(len)
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0
      ? s * 0x8000
      : s * 0x7FFF
  }
  return int16.buffer
}

function ensureStereo(
  inputL: Float32Array,
  inputR: Float32Array | undefined,
): Float32Array {
  if (inputR && inputL.length === inputR.length) {
    const stereo = new Float32Array(inputL.length * 2)
    for (let i = 0; i < inputL.length; i++) {
      stereo[i * 2] = inputL[i]
      stereo[i * 2 + 1] = inputR[i]
    }
    return stereo
  }
  const stereo = new Float32Array(inputL.length * 2)
  for (let i = 0; i < inputL.length; i++) {
    stereo[i * 2] = inputL[i]
    stereo[i * 2 + 1] = inputL[i]
  }
  return stereo
}

/* AudioWorklet processor that buffers input samples and posts them back to the
 * main thread via MessagePort. Output is silence — local playback for scene audio
 * elements is handled by the direct source→destination connection outside the
 * worklet, and browser-tab streaming intentionally has no local output. */
const WORKLET_CODE = /* js */ `
class PCMForwardProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const bs = (options.processorOptions && options.processorOptions.bufferSize) || 4096
    this._bufferSize = bs
    this._left = new Float32Array(bs)
    this._right = new Float32Array(bs)
    this._offset = 0
  }
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    const inL = input[0]
    const inR = input.length > 1 ? input[1] : inL

    let pos = 0
    while (pos < inL.length) {
      const space = this._bufferSize - this._offset
      const count = Math.min(space, inL.length - pos)
      this._left.set(inL.subarray(pos, pos + count), this._offset)
      this._right.set(inR.subarray(pos, pos + count), this._offset)
      this._offset += count
      pos += count

      if (this._offset >= this._bufferSize) {
        const l = this._left.slice()
        const r = this._right.slice()
        this.port.postMessage({ left: l, right: r }, [l.buffer, r.buffer])
        this._offset = 0
      }
    }
    return true
  }
}
registerProcessor('pcm-forward', PCMForwardProcessor)
`

const registeredContexts = new WeakSet<AudioContext>()

async function ensureWorklet(ctx: AudioContext): Promise<void> {
  if (registeredContexts.has(ctx))
    return
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    await ctx.audioWorklet.addModule(url)
    registeredContexts.add(ctx)
  }
  finally {
    URL.revokeObjectURL(url)
  }
}

function createWorkletNode(
  ctx: AudioContext,
  onChunk: AudioChunkCallback,
): AudioWorkletNode {
  const node = new AudioWorkletNode(ctx, 'pcm-forward', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: CHANNELS,
    processorOptions: { bufferSize: BUFFER_SIZE },
  })
  node.port.onmessage = (e: MessageEvent) => {
    const { left, right } = e.data as { left: Float32Array, right: Float32Array }
    const stereo = ensureStereo(left, right)
    const pcm = float32ToInt16(stereo)
    onChunk(pcm)
  }
  return node
}

const elementContexts = new WeakMap<HTMLAudioElement, {
  ctx: AudioContext
  source: MediaElementAudioSourceNode
  activeWorklet?: AudioWorkletNode
  unsubscribeSinkId: () => void
}>()

type SinkableContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }

/**
 * Once bound by createMediaElementSource the element plays through the
 * context's destination, so its own setSinkId (`bindAudioElement`) no longer
 * routes it; the context has to follow the Output Device instead (#650).
 */
function openElementContext(): { ctx: AudioContext, unsubscribeSinkId: () => void } {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE }) as SinkableContext
  // setSinkId rather than the constructor's sinkId, so a device that fails to
  // open degrades to a warning instead of failing the Discord capture.
  const route = (sinkId: string) => {
    if (!ctx.setSinkId || ctx.state === 'closed')
      return
    logInfo(`[audio] routing a captured audio element to ${sinkId === ''
      ? 'the system default'
      : `output ${sinkId}`}`)
    ctx.setSinkId(sinkId).catch((err) => {
      console.warn('[audio] could not move a captured audio element to the Output Device:', err)
    })
  }
  if (outputDeviceRouter.sinkId !== '')
    route(outputDeviceRouter.sinkId)
  const unsubscribeSinkId = outputDeviceRouter.subscribe(route)
  return { ctx, unsubscribeSinkId }
}

/**
 * Capture from an HTML5 audio element. The element must have a src and be playing.
 *
 * A single AudioContext + MediaElementSource is kept alive per element because
 * createMediaElementSource permanently binds the element; closing the context and
 * creating a new one for the same element would throw.
 */
export async function captureFromAudioElement(
  element: HTMLAudioElement,
  onChunk: AudioChunkCallback,
): Promise<CaptureSession> {
  let entry = elementContexts.get(element)
  if (!entry || entry.ctx.state === 'closed') {
    entry?.unsubscribeSinkId()
    const { ctx, unsubscribeSinkId } = openElementContext()
    let source: MediaElementAudioSourceNode
    try {
      source = ctx.createMediaElementSource(element)
    }
    catch (err) {
      unsubscribeSinkId()
      void ctx.close().catch(() => {})
      throw err
    }
    entry = { ctx, source, unsubscribeSinkId }
    elementContexts.set(element, entry)
  }

  const { ctx, source } = entry
  if (ctx.state === 'suspended')
    await ctx.resume()

  // Disconnect all existing connections (old worklet or direct-to-destination
  // left over from a previous stop()) before wiring the new capture graph.
  // Without this, a lingering source→destination connection causes local playback
  // when only streaming to Discord is intended.
  if (entry.activeWorklet) {
    entry.activeWorklet.disconnect()
    entry.activeWorklet.port.onmessage = null
    entry.activeWorklet = undefined
  }
  source.disconnect()

  await ensureWorklet(ctx)
  const worklet = createWorkletNode(ctx, onChunk)
  source.connect(worklet)
  worklet.connect(ctx.destination)
  entry.activeWorklet = worklet

  return {
    stop: () => {
      worklet.port.onmessage = null
      source.disconnect(worklet)
      worklet.disconnect()
      source.connect(ctx.destination)
      if (entry.activeWorklet === worklet)
        entry.activeWorklet = undefined
    },
  }
}

/**
 * Close and evict the AudioContext bound to an element, for callers that create
 * one HTMLAudioElement per trigger and discard it afterward (never calling
 * captureFromAudioElement on that same element again). Safe to call on an
 * element that was never captured.
 */
export function releaseAudioElementContext(element: HTMLAudioElement): void {
  const entry = elementContexts.get(element)
  if (!entry)
    return
  if (entry.activeWorklet) {
    entry.activeWorklet.port.onmessage = null
    entry.activeWorklet.disconnect()
  }
  entry.source.disconnect()
  entry.unsubscribeSinkId()
  elementContexts.delete(element)
  if (entry.ctx.state !== 'closed')
    entry.ctx.close().catch(() => {})
}

/** Chromium tab capture of a `WebContentsView` by the media source id the main process hands out (`browserView:getMediaSourceId`). */
export function captureTabStream(mediaSourceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: mediaSourceId,
      },
    } as MediaTrackConstraints,
    video: false,
  })
}

/**
 * Capture from a MediaStream (e.g. from getUserMedia tab capture or getDisplayMedia).
 */
export async function captureFromMediaStream(
  stream: MediaStream,
  onChunk: AudioChunkCallback,
): Promise<CaptureSession> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  try {
    if (ctx.state === 'suspended')
      await ctx.resume()
    await ensureWorklet(ctx)
  }
  catch (err) {
    // The caller gets the rejection and no session to stop, so nothing else would close this context.
    void ctx.close().catch(() => {})
    throw err
  }
  const source = ctx.createMediaStreamSource(stream)
  const worklet = createWorkletNode(ctx, onChunk)

  source.connect(worklet)
  worklet.connect(ctx.destination)

  return {
    stop: () => {
      worklet.port.onmessage = null
      worklet.disconnect()
      source.disconnect()
      stream.getTracks().forEach(t => t.stop())
      ctx.close()
    },
  }
}

/**
 * Request tab/window capture via getDisplayMedia. Returns a promise that resolves
 * with a CaptureSession when the user selects a source, or rejects if cancelled.
 */
export async function captureDisplayMedia(onChunk: AudioChunkCallback): Promise<CaptureSession> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  })
  const audioTracks = stream.getAudioTracks()
  if (audioTracks.length === 0)
    throw new Error('No audio in selected source. Ensure "Share audio" is checked when picking a tab.')
  return captureFromMediaStream(stream, onChunk)
}
