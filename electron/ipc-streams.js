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
    const obj = api[domain]
    if (!obj || typeof obj[method] !== 'function') {
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
    const stream = replace(streamsFor(audioStreams, guildId), streamId)
    warnedUnknown.delete(unknownKey('audio:chunk', guildId, streamId))
    ipcLog.info(`audio:startStream ${streamId} for guild ${guildId}`)
    player.startStream(guildId, stream, metadata, streamId)
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
    const stream = replace(streamsFor(effectStreams, guildId), id)
    warnedUnknown.delete(unknownKey('audio:effectChunk', guildId, id))
    ipcLog.info(`audio:startEffectStream ${id} for guild ${guildId}${volume !== undefined
      ? ` at volume ${volume}`
      : ''}`)
    player.startEffectStream(guildId, stream, id, volume)
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
}

module.exports = { createLocalSink, registerApiHandler, registerAudioStreamHandlers }
