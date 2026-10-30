const { PassThrough } = require('node:stream')
const { affectsHotkeys } = require('./hotkeys')
const { createLogger } = require('./logger')

const ipcLog = createLogger('ipc')

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

/** The generic `api` channel: dispatches `{ domain, method, args }` to the `EmbeddedApi` and logs every failed call. */
function registerApiHandler(ipcMain, api, getHotkeys) {
  ipcMain.handle('api', async (_, { domain, method, args }) => {
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
function registerAudioStreamHandlers(ipcMain, player) {
  /** Map<guildId, Map<streamId|undefined, PassThrough>> - multiple music streams per guild, mixed by backend */
  const audioStreams = new Map()
  /** Map<guildId, Map<streamId, PassThrough>> - multiple streams per guild, mixed by backend */
  const effectStreams = new Map()
  // Chunks still in flight after a stop are expected; warn once per unknown stream, not once per chunk.
  // Effect stream ids are random, so the set is bounded rather than left to grow for the whole session.
  const warnedUnknown = new Set()
  const MAX_WARNED_UNKNOWN = 256

  const streamsFor = (registry, guildId) => {
    if (!registry.has(guildId))
      registry.set(guildId, new Map())
    return registry.get(guildId)
  }

  const end = (streams, streamId) => {
    const stream = streams.get(streamId)
    if (stream) {
      streams.delete(streamId)
      stream.end()
    }
  }

  const replace = (streams, streamId) => {
    end(streams, streamId)
    const stream = new PassThrough()
    streams.set(streamId, stream)
    return stream
  }

  /**
   * Hands a freshly registered stream to the player. A stream the player did
   * not take (it threw, or returned anything but `true`, as for the Local
   * Target) has no consumer, so it is dropped from the registry instead of
   * buffering every later chunk.
   */
  const handOver = (lane, streams, streamId, guildId, start) => {
    let accepted
    try {
      accepted = start(streams.get(streamId))
    }
    catch (err) {
      ipcLog.warn(`${lane} ${streamId} for guild ${guildId} refused by the player; dropping it`)
      end(streams, streamId)
      throw err
    }
    if (accepted !== true) {
      ipcLog.info(`${lane} ${streamId} for guild ${guildId} not taken by the player; dropping it`)
      end(streams, streamId)
    }
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
    if (chunk && chunk.byteLength > 0)
      stream.push(Buffer.from(chunk))
  }

  ipcMain.handle('audio:startStream', async (_, { guildId, metadata, streamId }) => {
    const streams = streamsFor(audioStreams, guildId)
    replace(streams, streamId)
    warnedUnknown.delete(unknownKey('audio:chunk', guildId, streamId))
    ipcLog.info(`audio:startStream ${streamId} for guild ${guildId}`)
    handOver('audio:startStream', streams, streamId, guildId, stream => player.startStream(guildId, stream, metadata, streamId))
  })

  ipcMain.on('audio:chunk', (_, { guildId, streamId, chunk }) => {
    write('audio:chunk', audioStreams.get(guildId)?.get(streamId), guildId, streamId, chunk)
  })

  ipcMain.handle('audio:stopStream', async (_, { guildId, streamId }) => {
    const streams = audioStreams.get(guildId)
    if (streams)
      end(streams, streamId)
    ipcLog.info(`audio:stopStream ${streamId} for guild ${guildId}`)
    player.stopStream(guildId, streamId)
  })

  ipcMain.handle('audio:startEffectStream', async (_, { guildId, streamId, volume }) => {
    const id = streamId || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const streams = streamsFor(effectStreams, guildId)
    replace(streams, id)
    warnedUnknown.delete(unknownKey('audio:effectChunk', guildId, id))
    ipcLog.info(`audio:startEffectStream ${id} for guild ${guildId}${volume !== undefined
      ? ` at volume ${volume}`
      : ''}`)
    handOver('audio:startEffectStream', streams, id, guildId, stream => player.startEffectStream(guildId, stream, id, volume))
    return id
  })

  ipcMain.handle('audio:setEffectStreamVolume', async (_, { guildId, streamId, volume }) => {
    ipcLog.debug(`audio:setEffectStreamVolume ${streamId} = ${volume} for guild ${guildId}`)
    player.setEffectStreamVolume(guildId, streamId, volume)
  })

  ipcMain.on('audio:effectChunk', (_, { guildId, streamId, chunk }) => {
    const streams = effectStreams.get(guildId)
    const stream = streamId
      ? streams?.get(streamId)
      : streams?.values().next().value
    write('audio:effectChunk', stream, guildId, streamId, chunk)
  })

  ipcMain.handle('audio:stopEffectStream', async (_, { guildId, streamId }) => {
    const streams = effectStreams.get(guildId)
    if (!streams)
      return
    ipcLog.info(`audio:stopEffectStream ${streamId ?? '(all)'} for guild ${guildId}`)
    if (streamId) {
      end(streams, streamId)
    }
    else {
      streams.forEach(s => s.end())
      streams.clear()
    }
  })

  /**
   * Ends every stream on both lanes, e.g. after the renderer crashed or
   * reloaded and nobody is left to stop them. Music streams are also stopped
   * in the player so its state no longer reports them; an effect stream's
   * mixer input drains and removes itself once its source has ended.
   */
  const endAll = (reason) => {
    for (const [guildId, streams] of audioStreams) {
      for (const streamId of streams.keys()) {
        end(streams, streamId)
        ipcLog.info(`Ended music stream ${streamId} for guild ${guildId}: ${reason}`)
        try {
          player.stopStream(guildId, streamId)
        }
        catch (err) {
          ipcLog.error(`Could not stop music stream ${streamId} for guild ${guildId}:`, err)
        }
      }
    }
    for (const [guildId, streams] of effectStreams) {
      for (const streamId of streams.keys()) {
        end(streams, streamId)
        ipcLog.info(`Ended effect stream ${streamId} for guild ${guildId}: ${reason}`)
      }
    }
    audioStreams.clear()
    effectStreams.clear()
  }

  return { endAll }
}

module.exports = { createLocalSink, registerApiHandler, registerAudioStreamHandlers }
