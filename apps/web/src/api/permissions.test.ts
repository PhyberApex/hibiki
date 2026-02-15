import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchPermissionsConfig,
  updatePermissionsConfig,
} from './permissions'

describe('permissions API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchPermissionsConfig returns config', async () => {
    const config = {
      allowedDiscordRoleIds: ['role-1'],
      allowedDiscordUserIds: ['user-1'],
    }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(config),
    } as Response)
    const result = await fetchPermissionsConfig()
    expect(result).toEqual(config)
    expect(fetch).toHaveBeenCalledWith('/api/permissions/config', { signal: undefined })
  })

  it('fetchPermissionsConfig passes AbortSignal', async () => {
    const controller = new AbortController()
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ allowedDiscordRoleIds: [], allowedDiscordUserIds: [] }),
    } as Response)
    await fetchPermissionsConfig(controller.signal)
    expect(fetch).toHaveBeenCalledWith('/api/permissions/config', {
      signal: controller.signal,
    })
  })

  it('updatePermissionsConfig sends PUT with body', async () => {
    const config = {
      allowedDiscordRoleIds: ['r1'],
      allowedDiscordUserIds: ['u1'],
    }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(config),
    } as Response)
    const result = await updatePermissionsConfig(config)
    expect(result).toEqual(config)
    expect(fetch).toHaveBeenCalledWith('/api/permissions/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
  })

  it('throws with API message on error', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ message: 'Invalid config' })),
    } as Response)
    await expect(fetchPermissionsConfig()).rejects.toThrow('Invalid config')
  })

  it('throws with first message when message is array', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 422,
      text: () =>
        Promise.resolve(
          JSON.stringify({ message: ['First error', 'Second error'] }),
        ),
    } as Response)
    await expect(fetchPermissionsConfig()).rejects.toThrow('First error')
  })

  it('throws with response text when body is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    } as Response)
    await expect(fetchPermissionsConfig()).rejects.toThrow('Server error')
  })
})
