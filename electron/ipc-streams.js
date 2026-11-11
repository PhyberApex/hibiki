const { PassThrough } = require('node:stream')
const { affectsHotkeys } = require('./hotkeys')
const { createLogger } = require('./logger')

const ipcLog = createLogger('ipc')

/**
 * Ceilings on what the renderer can make main hold (#783). Every producer on
 * these lanes is a real-time capture sending 16 KiB of 48 kHz stereo s16le PCM
 * per worklet buffer, so these sit far above anything a healthy renderer does.
 *
 * `audio:chunk` / `audio:effectChunk` are fire-and-forget, so nothing slows the
 * renderer down, and `feedMixerInput` keeps the source paused between refills:
 * whatever arrives faster than the mixer plays it waits in the `PassThrough`.
 * Once `STREAM_BUFFER_BYTES` (about two seconds of audio) wait unread, chunks
 * are dropped rather than queued, which also keeps a stalled lane from
 * replaying stale audio for minutes once it resumes. The check runs before each
 * push, so the buffer peaks at that plus one chunk (at most `MAX_CHUNK_BYTES`).
 */
const MAX_CHUNK_BYTES = 1024 * 1024
const STREAM_BUFFER_BYTES = 48000 * 2 * 2 * 2
/** Per guild and per lane; each stream is a `PassThrough` plus a mixer input with its own poll timer. */
const MAX_STREAMS_PER_GUILD = 32

/**
 * The Local Target's sink (ADR-0004): the backend mix goes to the renderer as
 * `audio:localSinkStart` / `audio:localSinkChunk` / `audio:localSinkStop`, the
 * main -> renderer mirror of the `audio:*` chunk pattern. The renderer reports
 * health back through the `player.reportLocalSinkHealth` API call.
 */
function createLocalSink(getWindow) {
  const send = (channel, ...args) => {
    const win = getWindow()
    if (!win || win.isDestroyed())
      throw new Error('No renderer to play local audio in')
    win.webContents.send(channel, ...args)
  }
  return {
    start: () => {
      ipcLog.info('audio:localSinkStart')
      send('audio:localSinkStart')
    },
    // Copy: a Buffer from the mixer may be a slice of a larger pooled ArrayBuffer, which IPC would clone whole.
    write: packet => send('audio:localSinkChunk', Uint8Array.from(packet)),
    stop: () => {
      ipcLog.info('audio:localSinkStop')
      const win = getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send('audio:localSinkStop')
    },
  }
}

/**
 * The generic `api` channel: dispatches `{ domain, method, args }` to the `EmbeddedApi` and logs every failed call.
 * `ipc` is main's `trustedIpc`, so untrusted senders never reach the dispatch.
 */
function registerApiHandler(ipc, api, getHotkeys) {
  ipc.handle('api', async (_, { domain, method, args }) => {
    // Own properties only: `__proto__`, `constructor` and inherited methods are not part of the API.
    const obj = Object.hasOwn(api, domain)
      ? api[domain]
      : undefined
    if (!obj || !Object.hasOwn(obj, method) || typeof obj[method] !== 'function') {
      ipcLog.error(`Unknown API: ${domain}.${method}`)
      throw new Error(`Unknown API: ${domain}.${method}`)
    }
    try {
      const result = await obj[method](...args)
      const hotkeys = getHotkeys()
      if (hotkeys && affectsHotkeys(domain, method))
        await hotkeys.sync()
      return result
    }
    catch (err) {
      ipcLog.error(`${domain}.${method} failed:`, err)
      throw err
    }
  })
}

/**
 * The chunked-IPC audio lanes from the renderer: one `PassThrough` per `streamId`
 * per guild, piped into the backend player. The Music lane (`audio:startStream` /
 * `audio:chunk` / `audio:stopStream`) feeds `player.startStream`; the effect lane
 * (`audio:startEffectStream` / `audio:effectChunk` / `audio:stopEffectStream`)
 * feeds `player.startEffectStream`, one layered mixer input per stream, with
 * `audio:setEffectStreamVolume` adjusting a keyed stream live (a Routed Tab).
 *
 * Streams end only on an explicit stop from the renderer, so a renderer that
 * crashes or reloads would leave them as silent, still-"playing" mixer inputs:
 * main calls the returned `endAll(reason)` whenever the renderer goes away.
 */
function registerAudioStreamHandlers(ipc, player) {
  /** Map<guildId, Map<streamId|undefined, PassThrough>> - multiple music streams per guild, mixed by backend */
  const audioStreams = new Map()
  /** Map<guildId, Map<streamId, PassThrough>> - multiple streams per guild, mixed by backend */
  const effectStreams = new Map()
  // Chunks still in flight after a stop are expected; warn once per unknown stream, not once per chunk.
  // Effect stream ids are random, so the set is bounded rather than left to grow for the whole session.
  const warnedUnknown = new Set()
  const MAX_WARNED_UNKNOWN = 256

  /** Chunks dropped per stream (oversize or overflow), so each kind warns once and the total is logged at its end. */
  const dropped = new WeakMap()

  const streamsFor = (registry, guildId) => {
    if (!registry.has(guildId))
      registry.set(guildId, new Map())
    return registry.get(guildId)
  }

  /** Ends one stream and forgets its guild once that guild has none left on this lane. */
  const end = (registry, guildId, streamId) => {
    const streams = registry.get(guildId)
    const stream = streams?.get(streamId)
    if (stream) {
      streams.delete(streamId)
      stream.end()
      const drops = dropped.get(stream)
      if (drops)
        ipcLog.warn(`Stream ${streamId} in guild ${guildId} ended after dropping ${drops.oversize} oversize and ${drops.overflow} overflow chunk(s)`)
    }
    if (streams && streams.size === 0)
      registry.delete(guildId)
  }

  const replace = (registry, guildId, streamId) => {
    end(registry, guildId, streamId)
    const stream = new PassThrough({ readableHighWaterMark: STREAM_BUFFER_BYTES })
    streamsFor(registry, guildId).set(streamId, stream)
    return stream
  }

  /**
   * Registers a fresh stream under `streamId` (ending any previous one) and hands it to the player. A stream the player did
   * not take (it threw, or returned anything but `true`, as for the Local
   * Target) has no consumer, so it is dropped from the registry instead of
   * buffering every later chunk.
   */
  const openStream = (lane, registry, streamId, guildId, start) => {
    const streams = registry.get(guildId)
    if (streams && !streams.has(streamId) && streams.size >= MAX_STREAMS_PER_GUILD) {
      ipcLog.warn(`${lane} ${streamId} for guild ${guildId} refused: ${streams.size} streams already open (limit ${MAX_STREAMS_PER_GUILD})`)
      throw new Error(`Too many audio streams for guild ${guildId}`)
    }
    let accepted
    try {
      accepted = start(replace(registry, guildId, streamId))
    }
    catch (err) {
      ipcLog.warn(`${lane} ${streamId} for guild ${guildId} refused by the player; dropping it`)
      end(registry, guildId, streamId)
      throw err
    }
    if (accepted !== true) {
      ipcLog.info(`${lane} ${streamId} for guild ${guildId} not taken by the player; dropping it`)
      end(registry, guildId, streamId)
    }
  }

  /** Counts a dropped chunk, warning only on the first of each kind for this stream. */
  const drop = (lane, stream, guildId, streamId, kind, reason) => {
    const drops = dropped.get(stream) ?? { oversize: 0, overflow: 0 }
    dropped.set(stream, drops)
    if (drops[kind] === 0)
      ipcLog.warn(`${lane} for stream ${streamId} in guild ${guildId} ${reason}; dropping such chunks`)
    drops[kind]++
  }

  const unknownKey = (lane, guildId, streamId) => `${lane}:${guildId}:${streamId}`

  const write = (lane, stream, guildId, streamId, chunk) => {
    if (!stream) {
      const key = unknownKey(lane, guildId, streamId)
      if (!warnedUnknown.has(key)) {
        if (warnedUnknown.size >= MAX_WARNED_UNKNOWN)
          warnedUnknown.clear()
        warnedUnknown.add(key)
        ipcLog.warn(`${lane} for unknown stream ${streamId} in guild ${guildId}; dropping`)
      }
      return
    }
    if (!chunk || !(chunk.byteLength > 0))
      return
    if (chunk.byteLength > MAX_CHUNK_BYTES) {
      drop(lane, stream, guildId, streamId, 'oversize', `sent a ${chunk.byteLength}-byte chunk, above the ${MAX_CHUNK_BYTES}-byte limit`)
      return
    }
    // `push()` returned false once the buffer reached its high-water mark; past it nothing is reading fast enough.
    if (stream.readableLength >= stream.readableHighWaterMark) {
      drop(lane, stream, guildId, streamId, 'overflow', `is falling behind (${stream.readableLength} bytes unread)`)
      return
    }
    stream.push(Buffer.from(chunk))
  }

  ipc.handle('audio:startStream', async (_, { guildId, metadata, streamId }) => {
    warnedUnknown.delete(unknownKey('audio:chunk', guildId, streamId))
    ipcLog.info(`audio:startStream ${streamId} for guild ${guildId}`)
    openStream('audio:startStream', audioStreams, streamId, guildId, stream => player.startStream(guildId, stream, metadata, streamId))
  })

  ipc.on('audio:chunk', (_, { guildId, streamId, chunk }) => {
    write('audio:chunk', audioStreams.get(guildId)?.get(streamId), guildId, streamId, chunk)
  })

  ipc.handle('audio:stopStream', async (_, { guildId, streamId }) => {
    end(audioStreams, guildId, streamId)
    ipcLog.info(`audio:stopStream ${streamId} for guild ${guildId}`)
    player.stopStream(guildId, streamId)
  })

  ipc.handle('audio:startEffectStream', async (_, { guildId, streamId, volume }) => {
    const id = streamId || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    warnedUnknown.delete(unknownKey('audio:effectChunk', guildId, id))
    ipcLog.info(`audio:startEffectStream ${id} for guild ${guildId}${volume !== undefined
      ? ` at volume ${volume}`
      : ''}`)
    openStream('audio:startEffectStream', effectStreams, id, guildId, stream => player.startEffectStream(guildId, stream, id, volume))
    return id
  })

  ipc.handle('audio:setEffectStreamVolume', async (_, { guildId, streamId, volume }) => {
    ipcLog.debug(`audio:setEffectStreamVolume ${streamId} = ${volume} for guild ${guildId}`)
    player.setEffectStreamVolume(guildId, streamId, volume)
  })

  ipc.on('audio:effectChunk', (_, { guildId, streamId, chunk }) => {
    const streams = effectStreams.get(guildId)
    const stream = streamId
      ? streams?.get(streamId)
      : streams?.values().next().value
    write('audio:effectChunk', stream, guildId, streamId, chunk)
  })

  ipc.handle('audio:stopEffectStream', async (_, { guildId, streamId }) => {
    const streams = effectStreams.get(guildId)
    if (!streams)
      return
    ipcLog.info(`audio:stopEffectStream ${streamId ?? '(all)'} for guild ${guildId}`)
    const ids = streamId
      ? [streamId]
      : [
          ...streams.keys(),
        ]
    for (const id of ids)
      end(effectStreams, guildId, id)
  })

  /**
   * Ends every stream on both lanes, e.g. after the renderer crashed or
   * reloaded and nobody is left to stop them. Music streams are also stopped
   * in the player so its state no longer reports them; an effect stream's
   * mixer input drains and removes itself once its source has ended.
   */
  const endAll = (reason) => {
    for (const [guildId, streams] of Array.from(audioStreams)) {
      for (const streamId of Array.from(streams.keys())) {
        end(audioStreams, guildId, streamId)
        ipcLog.info(`Ended music stream ${streamId} for guild ${guildId}: ${reason}`)
        try {
          player.stopStream(guildId, streamId)
        }
        catch (err) {
          ipcLog.error(`Could not stop music stream ${streamId} for guild ${guildId}:`, err)
        }
      }
    }
    for (const [guildId, streams] of Array.from(effectStreams)) {
      for (const streamId of Array.from(streams.keys())) {
        end(effectStreams, guildId, streamId)
        ipcLog.info(`Ended effect stream ${streamId} for guild ${guildId}: ${reason}`)
      }
    }
  }

  /** How many guilds and streams both lanes hold; lets the specs see that emptied guilds are forgotten. */
  const registrySize = () => {
    let streams = 0
    for (const registry of [audioStreams, effectStreams]) {
      for (const guildStreams of registry.values())
        streams += guildStreams.size
    }
    const guilds = new Set(audioStreams.keys()).union(new Set(effectStreams.keys())).size
    return { guilds, streams }
  }

  return { endAll, registrySize }
}

module.exports = {
  createLocalSink,
  MAX_CHUNK_BYTES,
  MAX_STREAMS_PER_GUILD,
  registerApiHandler,
  registerAudioStreamHandlers,
  STREAM_BUFFER_BYTES,
}
