import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLogPath, openLogFolder } from './logs'

describe('logs API', () => {
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('fetchLogPath resolves null outside Electron', async () => {
    await expect(fetchLogPath()).resolves.toBeNull()
  })

  it('fetchLogPath asks the main process for the log file path', async () => {
    const invoke = vi.fn().mockResolvedValue('/data/logs/hibiki.log')
    ;(window as any).hibiki = { invoke }

    await expect(fetchLogPath()).resolves.toBe('/data/logs/hibiki.log')
    expect(invoke).toHaveBeenCalledWith('logs:getPath')
  })

  it('openLogFolder is a no-op outside Electron and delegates otherwise', async () => {
    await expect(openLogFolder()).resolves.toBeUndefined()

    const invoke = vi.fn().mockResolvedValue(undefined)
    ;(window as any).hibiki = { invoke }
    await openLogFolder()
    expect(invoke).toHaveBeenCalledWith('logs:openFolder')
  })
})
