import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sendAudioChunk,
  sendEffectChunk,
  startAudioStream,
  startEffectStream,
  stopAudioStream,
  stopEffectStream,
} from './audio-stream'

describe('audio-stream API', () => {
  const mockInvoke = vi.fn()
  const mockSend = vi.fn()

  beforeEach(() => {
    ;(window as any).hibiki = { invoke: mockInvoke, send: mockSend }
  })
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('startAudioStream uses invoke', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await startAudioStream('g1', { id: 'x', name: 'test', filename: 'x.mp3', category: 'music' })
    expect(mockInvoke).toHaveBeenCalledWith('audio:startStream', {
      guildId: 'g1',
      metadata: { id: 'x', name: 'test', filename: 'x.mp3', category: 'music' },
    })
  })

  it('stopAudioStream uses invoke', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await stopAudioStream('g1')
    expect(mockInvoke).toHaveBeenCalledWith('audio:stopStream', { guildId: 'g1' })
  })

  it('sendAudioChunk uses send', () => {
    const chunk = new ArrayBuffer(8)
    sendAudioChunk('g1', chunk)
    expect(mockSend).toHaveBeenCalledWith('audio:chunk', { guildId: 'g1', chunk })
  })

  it('startEffectStream uses invoke and returns streamId', async () => {
    mockInvoke.mockResolvedValue('stream-123')
    const id = await startEffectStream('g1')
    expect(mockInvoke).toHaveBeenCalledWith('audio:startEffectStream', { guildId: 'g1' })
    expect(id).toBe('stream-123')
  })

  it('startEffectStream with streamId passes it', async () => {
    mockInvoke.mockResolvedValue('ambience-1')
    await startEffectStream('g1', 'ambience-1')
    expect(mockInvoke).toHaveBeenCalledWith('audio:startEffectStream', {
      guildId: 'g1',
      streamId: 'ambience-1',
    })
  })

  it('sendEffectChunk uses send with streamId', () => {
    const chunk = new ArrayBuffer(8)
    sendEffectChunk('g1', chunk, 'stream-1')
    expect(mockSend).toHaveBeenCalledWith('audio:effectChunk', {
      guildId: 'g1',
      streamId: 'stream-1',
      chunk,
    })
  })

  it('stopEffectStream uses invoke with streamId', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await stopEffectStream('g1', 'stream-1')
    expect(mockInvoke).toHaveBeenCalledWith('audio:stopEffectStream', {
      guildId: 'g1',
      streamId: 'stream-1',
    })
  })

  it('throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => startAudioStream('g1')).toThrow('Electron')
  })

  it('sendEffectChunk throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => sendEffectChunk('g1', new ArrayBuffer(8))).toThrow('Electron')
  })

  it('stopEffectStream throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => stopEffectStream('g1')).toThrow('Electron')
  })

  it('startEffectStream throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => startEffectStream('g1')).toThrow('Electron')
  })

  it('sendAudioChunk throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => sendAudioChunk('g1', new ArrayBuffer(8))).toThrow('Electron')
  })
})
