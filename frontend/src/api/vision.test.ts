import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeImageVibe, matchVibe } from './vision'

describe('vision API', () => {
  const mockInvoke = vi.fn()

  beforeEach(() => {
    ;(window as any).hibiki = { invoke: mockInvoke }
  })
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('analyzeImageVibe uses apiCall with the image path', async () => {
    const analysis = { description: 'A stormy coast', tags: ['stormy', 'coast'] }
    mockInvoke.mockResolvedValue(analysis)
    const result = await analyzeImageVibe('/tmp/map.png')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'vision',
      method: 'analyzeImageVibe',
      args: ['/tmp/map.png'],
    })
    expect(result).toEqual(analysis)
  })

  it('matchVibe uses apiCall with the vibe tags', async () => {
    const matches = { music: [], ambience: [] }
    mockInvoke.mockResolvedValue(matches)
    const result = await matchVibe(['stormy'])
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'vision',
      method: 'matchVibe',
      args: [['stormy']],
    })
    expect(result).toEqual(matches)
  })

  it('throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => analyzeImageVibe('/tmp/map.png')).toThrow('Electron app')
  })
})
