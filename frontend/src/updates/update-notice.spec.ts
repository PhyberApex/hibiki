import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/stores/toast'
import { showUpdateNotice } from './update-notice'

const api = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  dismissUpdate: vi.fn(),
}))
vi.mock('@/api/updates', () => api)

describe('launch update notice', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    api.checkForUpdate.mockReset()
    api.dismissUpdate.mockReset().mockResolvedValue(undefined)
  })

  it('shows a sticky toast naming the version with a link to the release page', async () => {
    vi.useFakeTimers()
    api.checkForUpdate.mockResolvedValue({ version: '1.7.0', url: 'https://github.com/PhyberApex/hibiki/releases/tag/v1.7.0' })
    await showUpdateNotice()
    const toast = useToastStore()
    expect(toast.toasts).toHaveLength(1)
    expect(toast.toasts[0].text).toContain('1.7.0')
    expect(toast.toasts[0].link).toEqual({ label: 'View release', url: 'https://github.com/PhyberApex/hibiki/releases/tag/v1.7.0' })
    vi.advanceTimersByTime(60_000)
    expect(toast.toasts).toHaveLength(1)
    vi.useRealTimers()
  })

  it('remembers the version when the GM dismisses the toast', async () => {
    api.checkForUpdate.mockResolvedValue({ version: '1.7.0', url: 'https://github.com/PhyberApex/hibiki/releases/tag/v1.7.0' })
    await showUpdateNotice()
    const toast = useToastStore()
    toast.dismissByUser(toast.toasts[0].id)
    expect(api.dismissUpdate).toHaveBeenCalledWith('1.7.0')
  })

  it('shows nothing when there is no newer release', async () => {
    api.checkForUpdate.mockResolvedValue(null)
    await showUpdateNotice()
    expect(useToastStore().toasts).toHaveLength(0)
  })

  it('swallows a failed check so launch is never affected', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.checkForUpdate.mockRejectedValue(new Error('boom'))
    await expect(showUpdateNotice()).resolves.toBeUndefined()
    expect(useToastStore().toasts).toHaveLength(0)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
