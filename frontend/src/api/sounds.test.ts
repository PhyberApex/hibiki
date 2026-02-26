import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteSound,
  listEffects,
  listMusic,
  soundStreamUrl,
  uploadSound,
  uploadSoundsBulk,
} from './sounds'

describe('sounds API', () => {
  const mockInvoke = vi.fn()

  beforeEach(() => {
    ;(window as any).hibiki = { invoke: mockInvoke }
  })
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('listMusic uses apiCall', async () => {
    mockInvoke.mockResolvedValue([])
    await listMusic()
    expect(mockInvoke).toHaveBeenCalledWith('api', { domain: 'sounds', method: 'listMusic', args: [] })
  })

  it('listEffects uses apiCall', async () => {
    mockInvoke.mockResolvedValue([])
    await listEffects()
    expect(mockInvoke).toHaveBeenCalledWith('api', { domain: 'sounds', method: 'listEffects', args: [] })
  })

  it('uploadSound uses apiCall', async () => {
    const file = new File(['x'], 'test.mp3', { type: 'audio/mpeg' })
    mockInvoke.mockResolvedValue({ id: 'x', name: 'test', filename: 'test.mp3', category: 'music' })
    await uploadSound('music', file)
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'sounds',
      method: 'uploadSound',
      args: ['music', expect.any(ArrayBuffer), 'test.mp3'],
    })
  })

  it('uploadSoundsBulk uploads each file', async () => {
    const file1 = new File(['a'], 'a.mp3', { type: 'audio/mpeg' })
    const file2 = new File(['b'], 'b.mp3', { type: 'audio/mpeg' })
    mockInvoke
      .mockResolvedValueOnce({ id: '1', name: 'a', filename: 'a.mp3', category: 'music' })
      .mockRejectedValueOnce(new Error('Network error'))
    const result = await uploadSoundsBulk('music', [file1, file2])
    expect(result.success).toHaveLength(1)
    expect(result.success[0]!.id).toBe('1')
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.file.name).toBe('b.mp3')
  })

  it('deleteSound uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await deleteSound('effects', 'id1')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'sounds',
      method: 'deleteSound',
      args: ['effects', 'id1'],
    })
  })

  it('soundStreamUrl returns hibiki URL', () => {
    expect(soundStreamUrl('music', 'id1')).toBe('hibiki://sound/music/id1')
    expect(soundStreamUrl('effects', 'e1')).toBe('hibiki://sound/effects/e1')
  })

  it('throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => listMusic()).toThrow('Electron app')
  })
})
