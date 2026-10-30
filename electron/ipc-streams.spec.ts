import type { Readable } from 'node:stream'
import { createLocalSink, registerApiHandler, registerAudioStreamHandlers } from './ipc-streams'

type Handler = (event: unknown, payload: any) => unknown

function fakeIpcMain() {
  const handlers = new Map<string, Handler>()
  const listeners = new Map<string, Handler>()
  return {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => listeners.set(channel, fn),
    invoke: (channel: string, payload: unknown) => handlers.get(channel)!({}, payload),
    send: (channel: string, payload: unknown) => listeners.get(channel)!({}, payload),
  }
}

function fakePlayer() {
  return {
    startStream: jest.fn(() => true),
    stopStream: jest.fn(),
    startEffectStream: jest.fn(() => true),
    setEffectStreamVolume: jest.fn(),
  }
}

function collect(stream: Readable): Buffer[] {
  const chunks: Buffer[] = []
  stream.on('data', (c: Buffer) => chunks.push(c))
  return chunks
}

function ended(stream: Readable): Promise<void> {
  return new Promise(resolve => stream.once('end', () => resolve()))
}

const spies = {
  info: jest.spyOn(console, 'info').mockImplementation(() => {}),
  warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
  error: jest.spyOn(console, 'error').mockImplementation(() => {}),
}

afterEach(() => jest.clearAllMocks())
afterAll(() => jest.restoreAllMocks())

describe('registerAudioStreamHandlers: Music lane', () => {
  it('pipes a new stream to player.startStream, writes chunks in order and ends it on stop', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    registerAudioStreamHandlers(ipc, player)

    await ipc.invoke('audio:startStream', {
      guildId: 'g1',
      streamId: 's1',
      metadata: { title: 'Song' },
    })
    expect(player.startStream).toHaveBeenCalledWith('g1', expect.anything(), { title: 'Song' }, 's1')
    const stream: Readable = player.startStream.mock.calls[0][1]
    const chunks = collect(stream)
    const done = ended(stream)

    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 's1',
      chunk: new Uint8Array([1, 2]),
    })
    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 's1',
      chunk: new Uint8Array([]),
    })
    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 's1',
      chunk: new Uint8Array([3]),
    })
    await ipc.invoke('audio:stopStream', { guildId: 'g1', streamId: 's1' })
    await done

    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]))
    expect(player.stopStream).toHaveBeenCalledWith('g1', 's1')
  })

  it('ends the previous stream when the same streamId starts again', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    registerAudioStreamHandlers(ipc, player)

    await ipc.invoke('audio:startStream', { guildId: 'g1', streamId: 's1' })
    const first: Readable = player.startStream.mock.calls[0][1]
    collect(first)
    const firstEnded = ended(first)
    await ipc.invoke('audio:startStream', { guildId: 'g1', streamId: 's1' })
    await firstEnded

    const second: Readable = player.startStream.mock.calls[1][1]
    const chunks = collect(second)
    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 's1',
      chunk: new Uint8Array([9]),
    })
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([9]))
  })

  it('drops chunks for an unknown streamId with one warn per stream', async () => {
    const ipc = fakeIpcMain()
    registerAudioStreamHandlers(ipc, fakePlayer())

    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 'ghost',
      chunk: new Uint8Array([1]),
    })
    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 'ghost',
      chunk: new Uint8Array([2]),
    })
    await ipc.invoke('audio:startStream', { guildId: 'g1', streamId: 'other' })
    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 'ghost',
      chunk: new Uint8Array([3]),
    })

    expect(spies.warn).toHaveBeenCalledTimes(1)
    expect(spies.warn).toHaveBeenCalledWith('[ipc]', expect.stringContaining('unknown stream ghost in guild g1'))
  })

  it('warns again after the stream has been started and stopped', async () => {
    const ipc = fakeIpcMain()
    registerAudioStreamHandlers(ipc, fakePlayer())

    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 's1',
      chunk: new Uint8Array([1]),
    })
    await ipc.invoke('audio:startStream', { guildId: 'g1', streamId: 's1' })
    await ipc.invoke('audio:stopStream', { guildId: 'g1', streamId: 's1' })
    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 's1',
      chunk: new Uint8Array([2]),
    })

    expect(spies.warn).toHaveBeenCalledTimes(2)
  })

  it('forgets old unknown streams once 256 have warned, so the set stays bounded', () => {
    const ipc = fakeIpcMain()
    registerAudioStreamHandlers(ipc, fakePlayer())

    for (let i = 0; i < 257; i++) {
      ipc.send('audio:chunk', {
        guildId: 'g1',
        streamId: `s${i}`,
        chunk: new Uint8Array([1]),
      })
    }
    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 's0',
      chunk: new Uint8Array([1]),
    })

    expect(spies.warn).toHaveBeenCalledTimes(258)
  })

  it('still tells the player to stop when the stream is not known', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    registerAudioStreamHandlers(ipc, player)

    await ipc.invoke('audio:stopStream', { guildId: 'g1', streamId: 's1' })

    expect(player.stopStream).toHaveBeenCalledWith('g1', 's1')
  })
})

describe('registerAudioStreamHandlers: effect lane', () => {
  it('generates an id, pipes the stream to player.startEffectStream and ends it on stop', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    registerAudioStreamHandlers(ipc, player)

    const id = await ipc.invoke('audio:startEffectStream', { guildId: 'g1' })
    expect(id).toMatch(/^stream-/)
    const stream: Readable = player.startEffectStream.mock.calls[0][1]
    expect(player.startEffectStream).toHaveBeenCalledWith('g1', stream, id, undefined)
    const chunks = collect(stream)
    const done = ended(stream)

    ipc.send('audio:effectChunk', {
      guildId: 'g1',
      streamId: id,
      chunk: new Uint8Array([4]),
    })
    ipc.send('audio:effectChunk', {
      guildId: 'g1',
      streamId: id,
      chunk: new Uint8Array([5]),
    })
    await ipc.invoke('audio:stopEffectStream', { guildId: 'g1', streamId: id })
    await done

    expect(Buffer.concat(chunks)).toEqual(Buffer.from([4, 5]))
  })

  it('keeps a caller-chosen id and replaces a stream started under it before', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    registerAudioStreamHandlers(ipc, player)

    expect(await ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'ambience-a' })).toBe('ambience-a')
    const first: Readable = player.startEffectStream.mock.calls[0][1]
    collect(first)
    const firstEnded = ended(first)
    await ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'ambience-a' })

    await firstEnded
  })

  it('passes a caller-chosen id and initial volume on to the player, and forwards live volume changes', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    registerAudioStreamHandlers(ipc, player)

    await ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'browser-7', volume: 42 })
    expect(player.startEffectStream).toHaveBeenCalledWith('g1', expect.anything(), 'browser-7', 42)

    await ipc.invoke('audio:setEffectStreamVolume', { guildId: 'g1', streamId: 'browser-7', volume: 21 })
    expect(player.setEffectStreamVolume).toHaveBeenCalledWith('g1', 'browser-7', 21)
  })

  it('routes a chunk without a streamId to the guild\'s first effect stream', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    registerAudioStreamHandlers(ipc, player)

    await ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'a' })
    await ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'b' })
    const first = collect(player.startEffectStream.mock.calls[0][1])
    const second = collect(player.startEffectStream.mock.calls[1][1])

    ipc.send('audio:effectChunk', {
      guildId: 'g1',
      chunk: new Uint8Array([7]),
    })

    expect(Buffer.concat(first)).toEqual(Buffer.from([7]))
    expect(second).toHaveLength(0)
  })

  it('ends every stream of the guild when stopped without a streamId', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    registerAudioStreamHandlers(ipc, player)

    await ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'a' })
    await ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'b' })
    const streams: Readable[] = player.startEffectStream.mock.calls.map(c => c[1])
    streams.forEach(collect)
    const allEnded = Promise.all(streams.map(ended))

    await ipc.invoke('audio:stopEffectStream', { guildId: 'g1' })
    await allEnded

    ipc.send('audio:effectChunk', {
      guildId: 'g1',
      streamId: 'a',
      chunk: new Uint8Array([1]),
    })
    expect(spies.warn).toHaveBeenCalledWith('[ipc]', expect.stringContaining('unknown stream a in guild g1'))
  })

  it('drops chunks and stops for a guild with no effect streams', async () => {
    const ipc = fakeIpcMain()
    registerAudioStreamHandlers(ipc, fakePlayer())

    ipc.send('audio:effectChunk', {
      guildId: 'g9',
      streamId: 'x',
      chunk: new Uint8Array([1]),
    })
    await expect(ipc.invoke('audio:stopEffectStream', { guildId: 'g9', streamId: 'x' })).resolves.toBeUndefined()

    expect(spies.warn).toHaveBeenCalledTimes(1)
  })
})

describe('registerAudioStreamHandlers: start failures', () => {
  it('leaves no entry when player.startStream throws, so later chunks are dropped', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    player.startStream.mockImplementation(() => {
      throw new Error('Not connected to a voice channel. Join first.')
    })
    registerAudioStreamHandlers(ipc, player)

    await expect(ipc.invoke('audio:startStream', { guildId: 'g1', streamId: 's1' })).rejects.toThrow('Not connected')
    const stream: Readable = player.startStream.mock.calls[0][1]
    expect(stream.writableEnded).toBe(true)

    ipc.send('audio:chunk', {
      guildId: 'g1',
      streamId: 's1',
      chunk: new Uint8Array([1]),
    })
    expect(stream.readableLength).toBe(0)
    expect(spies.warn).toHaveBeenCalledWith('[ipc]', expect.stringContaining('unknown stream s1 in guild g1'))
  })

  it('leaves no entry when player.startEffectStream throws', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    player.startEffectStream.mockImplementation(() => {
      throw new Error('Not connected to a voice channel. Join first.')
    })
    registerAudioStreamHandlers(ipc, player)

    await expect(ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'browser-1' })).rejects.toThrow('Not connected')
    const stream: Readable = player.startEffectStream.mock.calls[0][1]
    expect(stream.writableEnded).toBe(true)

    ipc.send('audio:effectChunk', {
      guildId: 'g1',
      streamId: 'browser-1',
      chunk: new Uint8Array([1]),
    })
    expect(stream.readableLength).toBe(0)
  })

  it.each([
    false,
    undefined,
  ])('leaves no entry when the player does not take the stream (returns %s, as for the Local Target)', async (accepted) => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    player.startStream.mockReturnValue(accepted as boolean)
    player.startEffectStream.mockReturnValue(accepted as boolean)
    registerAudioStreamHandlers(ipc, player)

    await ipc.invoke('audio:startStream', { guildId: 'local', streamId: 's1' })
    await ipc.invoke('audio:startEffectStream', { guildId: 'local', streamId: 'browser-1' })
    const music: Readable = player.startStream.mock.calls[0][1]
    const effect: Readable = player.startEffectStream.mock.calls[0][1]

    ipc.send('audio:chunk', {
      guildId: 'local',
      streamId: 's1',
      chunk: new Uint8Array([1]),
    })
    ipc.send('audio:effectChunk', {
      guildId: 'local',
      streamId: 'browser-1',
      chunk: new Uint8Array([1]),
    })
    expect(music.writableEnded).toBe(true)
    expect(effect.writableEnded).toBe(true)
    expect(music.readableLength).toBe(0)
    expect(effect.readableLength).toBe(0)
  })
})

describe('registerAudioStreamHandlers: endAll', () => {
  it('ends every stream on both lanes, tells the player to stop the Music streams and logs each id', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    const streams = registerAudioStreamHandlers(ipc, player)

    await ipc.invoke('audio:startStream', { guildId: 'g1', streamId: 's1' })
    await ipc.invoke('audio:startStream', { guildId: 'g2', streamId: 's2' })
    await ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'browser-3' })
    const all: Readable[] = [
      ...player.startStream.mock.calls.map(c => c[1]),
      ...player.startEffectStream.mock.calls.map(c => c[1]),
    ]
    all.forEach(collect)
    const allEnded = Promise.all(all.map(ended))

    streams.endAll('renderer crashed')
    await allEnded

    expect(player.stopStream).toHaveBeenCalledWith('g1', 's1')
    expect(player.stopStream).toHaveBeenCalledWith('g2', 's2')
    expect(player.stopStream).toHaveBeenCalledTimes(2)
    for (const id of ['s1', 's2', 'browser-3'])
      expect(spies.info).toHaveBeenCalledWith('[ipc]', expect.stringMatching(new RegExp(`${id}.*renderer crashed`)))
  })

  it('forgets every stream, so late chunks are dropped and a second endAll is a no-op', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    const streams = registerAudioStreamHandlers(ipc, player)

    await ipc.invoke('audio:startStream', { guildId: 'g1', streamId: 's1' })
    await ipc.invoke('audio:startEffectStream', { guildId: 'g1', streamId: 'browser-3' })
    streams.endAll('reload')
    ipc.send('audio:effectChunk', {
      guildId: 'g1',
      streamId: 'browser-3',
      chunk: new Uint8Array([1]),
    })
    expect(spies.warn).toHaveBeenCalledWith('[ipc]', expect.stringContaining('unknown stream browser-3 in guild g1'))

    player.stopStream.mockClear()
    streams.endAll('closed')
    expect(player.stopStream).not.toHaveBeenCalled()
  })

  it('keeps tearing down the other streams when player.stopStream throws', async () => {
    const ipc = fakeIpcMain()
    const player = fakePlayer()
    const streams = registerAudioStreamHandlers(ipc, player)
    await ipc.invoke('audio:startStream', { guildId: 'g1', streamId: 's1' })
    await ipc.invoke('audio:startStream', { guildId: 'g2', streamId: 's2' })
    player.stopStream.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    expect(() => streams.endAll('closed')).not.toThrow()
    expect(player.stopStream).toHaveBeenCalledTimes(2)
    expect(player.startStream.mock.calls[1][1].writableEnded).toBe(true)
    expect(spies.error).toHaveBeenCalled()
  })
})

describe('registerApiHandler', () => {
  it('dispatches to the domain method and returns its result', async () => {
    const ipc = fakeIpcMain()
    const api = {
      player: {
        join: jest.fn().mockResolvedValue('ok'),
      },
    }
    registerApiHandler(ipc, api, () => null)

    await expect(ipc.invoke('api', {
      domain: 'player',
      method: 'join',
      args: ['g1', 'c1'],
    })).resolves.toBe('ok')
    expect(api.player.join).toHaveBeenCalledWith('g1', 'c1')
  })

  it('rejects and logs an unknown domain or method', async () => {
    const ipc = fakeIpcMain()
    registerApiHandler(ipc, { player: {} }, () => null)

    await expect(ipc.invoke('api', { domain: 'player', method: 'nope', args: [] })).rejects.toThrow('Unknown API: player.nope')
    await expect(ipc.invoke('api', { domain: 'ghost', method: 'x', args: [] })).rejects.toThrow('Unknown API: ghost.x')
    expect(spies.error).toHaveBeenCalledWith('[ipc]', 'Unknown API: player.nope')
  })

  it.each([
    ['__proto__', 'hasOwnProperty'],
    ['constructor', 'assign'],
    ['player', 'constructor'],
    ['player', 'toString'],
    ['player', '__proto__'],
  ])('rejects the inherited %s.%s', async (domain, method) => {
    const ipc = fakeIpcMain()
    registerApiHandler(ipc, {
      player: {
        join: jest.fn(),
      },
    }, () => null)

    await expect(ipc.invoke('api', { domain, method, args: [] })).rejects.toThrow(`Unknown API: ${domain}.${method}`)
  })

  it('logs and rethrows a failing call', async () => {
    const ipc = fakeIpcMain()
    const err = new Error('boom')
    registerApiHandler(ipc, {
      sounds: {
        delete: jest.fn().mockRejectedValue(err),
      },
    }, () => null)

    await expect(ipc.invoke('api', { domain: 'sounds', method: 'delete', args: [] })).rejects.toBe(err)
    expect(spies.error).toHaveBeenCalledWith('[ipc]', 'sounds.delete failed:', err)
  })

  it('re-syncs hotkeys after a call that may change them, and only then', async () => {
    const ipc = fakeIpcMain()
    const hotkeys = {
      sync: jest.fn().mockResolvedValue(undefined),
    }
    const api = {
      scenes: {
        save: jest.fn(),
      },
      player: {
        stop: jest.fn(),
      },
    }
    registerApiHandler(ipc, api, () => hotkeys)

    await ipc.invoke('api', { domain: 'player', method: 'stop', args: [] })
    expect(hotkeys.sync).not.toHaveBeenCalled()
    await ipc.invoke('api', { domain: 'scenes', method: 'save', args: [] })
    expect(hotkeys.sync).toHaveBeenCalledTimes(1)
  })
})

describe('createLocalSink', () => {
  function fakeWindow() {
    return {
      isDestroyed: jest.fn(() => false),
      webContents: {
        send: jest.fn(),
      },
    }
  }

  it('forwards start, chunk and stop to webContents.send', () => {
    const win = fakeWindow()
    const sink = createLocalSink(() => win)

    sink.start()
    sink.write(Buffer.from([1, 2, 3]))
    sink.stop()

    expect(win.webContents.send.mock.calls).toEqual([
      ['audio:localSinkStart'],
      [
        'audio:localSinkChunk',
        Uint8Array.from([1, 2, 3]),
      ],
      ['audio:localSinkStop'],
    ])
  })

  it('sends chunks as a copy, not the pooled Buffer slice itself', () => {
    const win = fakeWindow()
    const pool = Buffer.from([0, 1, 2, 3, 4, 5])
    createLocalSink(() => win).write(pool.subarray(2, 4))

    const sent: Uint8Array = win.webContents.send.mock.calls[0][1]
    expect(sent).not.toBeInstanceOf(Buffer)
    expect(sent.buffer.byteLength).toBe(2)
  })

  it('throws on start and write without a live window, but stop is a no-op', () => {
    const destroyed = fakeWindow()
    destroyed.isDestroyed.mockReturnValue(true)
    for (const getWindow of [
      () => null,
      () => destroyed,
    ]) {
      const sink = createLocalSink(getWindow)
      expect(() => sink.start()).toThrow('No renderer to play local audio in')
      expect(() => sink.write(Buffer.from([1]))).toThrow('No renderer to play local audio in')
      expect(() => sink.stop()).not.toThrow()
    }
    expect(destroyed.webContents.send).not.toHaveBeenCalled()
  })
})
