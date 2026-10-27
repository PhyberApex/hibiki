import type { HotkeyDeps, HotkeyOutcome } from './dispatch'
import type { HotkeySettings } from '@/api/config'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchHotkeySettings } from '@/api/config'
import { fetchHotkeyStatus, onHotkeyFired } from '@/api/hotkeys'
import { trackUsage } from '@/api/usage-stats'
import { dispatchHotkey } from './dispatch'
import { reportHotkeyRegistrationFailures, startHotkeyDispatch } from './index'

const toast = {
  show: vi.fn(),
}
const player = {
  playingSceneId: 'storm',
  targetId: 'local',
  canPlay: true,
  activeEffectCount: vi.fn(() => 0),
}
const playback = {
  playScene: vi.fn(),
  crossfadeToScene: vi.fn(),
  stopScene: vi.fn(),
  stopAllEffectInstances: vi.fn(),
  stepMasterVolume: vi.fn(),
  playEffect: vi.fn(),
}

vi.mock('@/stores/toast', () => ({
  useToastStore: () => toast,
}))
vi.mock('@/stores/player', () => ({
  usePlayerStore: () => player,
}))
vi.mock('@/stores/scene-playback', () => ({
  useScenePlaybackStore: () => playback,
}))
vi.mock('@/api/hotkeys', () => ({
  fetchHotkeyStatus: vi.fn(),
  onHotkeyFired: vi.fn(),
}))
vi.mock('@/api/config', () => ({
  fetchHotkeySettings: vi.fn(),
}))
vi.mock('@/api/scenes', () => ({
  listScenes: vi.fn(),
}))
vi.mock('@/api/usage-stats', () => ({
  trackUsage: vi.fn(),
}))
vi.mock('./dispatch', () => ({
  dispatchHotkey: vi.fn(),
}))

/** Installs the dispatch and returns the `hotkey:fired` listener it registered plus its unsubscribe. */
function install() {
  const off = vi.fn()
  vi.mocked(onHotkeyFired).mockReturnValue(off)
  const stop = startHotkeyDispatch()
  const fire = vi.mocked(onHotkeyFired).mock.calls[0][0]
  return { fire, stop, off }
}

describe('startHotkeyDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(dispatchHotkey).mockResolvedValue('played')
  })

  it('registers exactly one hotkey:fired listener', () => {
    install()
    expect(onHotkeyFired).toHaveBeenCalledOnce()
  })

  it('dispatches a fired accelerator once', async () => {
    const { fire } = install()
    fire('F13')
    await flushPromises()
    expect(dispatchHotkey).toHaveBeenCalledExactlyOnceWith('F13', expect.any(Object))
  })

  it('handles one press at a time: the second waits for the first to finish', async () => {
    let finishFirst!: (outcome: HotkeyOutcome) => void
    vi.mocked(dispatchHotkey).mockImplementationOnce(() => new Promise<HotkeyOutcome>((resolve) => {
      finishFirst = resolve
    }))
    const { fire } = install()
    fire('F13')
    fire('F13')
    await flushPromises()
    expect(vi.mocked(dispatchHotkey).mock.calls.map(c => c[0])).toEqual(['F13'])
    finishFirst('played')
    await flushPromises()
    expect(vi.mocked(dispatchHotkey).mock.calls.map(c => c[0])).toEqual(['F13', 'F13'])
  })

  it('returns the unsubscribe that removes the listener', () => {
    const { stop, off } = install()
    stop()
    expect(off).toHaveBeenCalledOnce()
  })

  it('wires the dispatch deps to the stores, config, toasts and usage stats', async () => {
    const { fire } = install()
    fire('F13')
    await flushPromises()
    const deps = vi.mocked(dispatchHotkey).mock.calls[0][1] as HotkeyDeps

    expect(deps.playingSceneId()).toBe('storm')
    expect(deps.activeTargetId()).toBe('local')
    expect(deps.canPlay()).toBe(true)
    expect(deps.playScene).toBe(playback.playScene)
    expect(deps.stopAllEffects).toBe(playback.stopAllEffectInstances)

    vi.mocked(fetchHotkeySettings).mockResolvedValue({ enabled: true, stopHotkey: 'F16' } as HotkeySettings)
    await expect(deps.getActionHotkeys()).resolves.toEqual({ stopHotkey: 'F16' })

    deps.showVolume(40)
    expect(toast.show).toHaveBeenCalledWith({ type: 'info', key: 'master-volume', text: 'Master volume 40%' })
    deps.refuse('No Scene is playing')
    expect(toast.show).toHaveBeenCalledWith({ type: 'warning', text: 'No Scene is playing' })
    deps.trackFired('scene')
    expect(trackUsage).toHaveBeenCalledWith({
      name: 'hotkey-fired',
      data: { kind: 'scene' },
    })
  })
})

describe('reportHotkeyRegistrationFailures', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stays quiet when every key registered', async () => {
    vi.mocked(fetchHotkeyStatus).mockResolvedValue({
      enabled: true,
      registered: ['F13'],
      failures: [],
    })
    await reportHotkeyRegistrationFailures()
    expect(toast.show).not.toHaveBeenCalled()
  })

  it('groups refused keys into one warning, each key named once', async () => {
    vi.mocked(fetchHotkeyStatus).mockResolvedValue({
      enabled: true,
      registered: [],
      failures: [
        { accelerator: 'F13', owner: 'scene:storm', reason: 'taken' },
        { accelerator: 'F13', owner: 'effect:thunder', reason: 'taken' },
        { accelerator: 'F14', owner: 'action:stop', reason: 'taken' },
      ],
    })
    await reportHotkeyRegistrationFailures()
    expect(toast.show).toHaveBeenCalledOnce()
    expect(toast.show.mock.calls[0][0]).toMatchObject({ type: 'warning', durationMs: 10_000 })
    expect(toast.show.mock.calls[0][0].text).toContain('F13, F14.')
  })

  it('logs instead of throwing when the status cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetchHotkeyStatus).mockRejectedValue(new Error('main gone'))
    await expect(reportHotkeyRegistrationFailures()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('[hotkeys] Could not read registration status:', expect.any(Error))
    expect(toast.show).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
