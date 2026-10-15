import type { HotkeyDeps } from './dispatch'
import type { Scene } from '@/api/scenes'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchHotkey } from './dispatch'

function scene(id: string, hotkey?: string, effects: Scene['effects'] = []): Scene {
  return { id, name: id, hotkey, ambience: [], music: [], effects, createdAt: '', updatedAt: '' }
}

const storm = scene('storm', 'F13', [{ soundId: 'thunder', hotkey: 'F14' }])
const tavern = scene('tavern', 'F15', [{ soundId: 'cheer', hotkey: 'F14' }])

function makeDeps(overrides: Partial<HotkeyDeps> = {}): HotkeyDeps {
  return {
    listScenes: vi.fn().mockResolvedValue([storm, tavern]),
    getStopHotkey: vi.fn().mockResolvedValue('F16'),
    playingSceneId: () => null,
    activeTargetId: () => 'local',
    canPlay: () => true,
    playScene: vi.fn().mockResolvedValue(undefined),
    crossfadeToScene: vi.fn().mockResolvedValue(undefined),
    stopScene: vi.fn(),
    playEffect: vi.fn().mockResolvedValue(undefined),
    refuse: vi.fn(),
    logInfo: vi.fn(),
    logDebug: vi.fn(),
    ...overrides,
  }
}

describe('hotkey dispatcher', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('plays a Scene when nothing is playing', async () => {
    const deps = makeDeps()
    expect(await dispatchHotkey('F13', deps)).toBe('played')
    expect(deps.playScene).toHaveBeenCalledWith(storm)
  })

  it('crossfades when another Scene is the Playing Scene', async () => {
    const deps = makeDeps({ playingSceneId: () => 'tavern' })
    expect(await dispatchHotkey('F13', deps)).toBe('crossfaded')
    expect(deps.crossfadeToScene).toHaveBeenCalledWith('storm')
    expect(deps.playScene).not.toHaveBeenCalled()
  })

  it('stops when the pressed Scene is already the Playing Scene', async () => {
    const deps = makeDeps({ playingSceneId: () => 'storm' })
    expect(await dispatchHotkey('F13', deps)).toBe('stopped')
    expect(deps.stopScene).toHaveBeenCalled()
    expect(deps.playScene).not.toHaveBeenCalled()
  })

  it('the Stop Hotkey stops the Playing Scene, and is ignored when nothing plays', async () => {
    const playing = makeDeps({ playingSceneId: () => 'storm' })
    expect(await dispatchHotkey('F16', playing)).toBe('stopped')
    expect(playing.stopScene).toHaveBeenCalled()
    const idle = makeDeps()
    expect(await dispatchHotkey('F16', idle)).toBe('ignored')
    expect(idle.stopScene).not.toHaveBeenCalled()
  })

  it('triggers an Effect Hotkey only within the Playing Scene, resolving a key shared across Scenes', async () => {
    const deps = makeDeps({ playingSceneId: () => 'tavern' })
    expect(await dispatchHotkey('F14', deps)).toBe('effect')
    expect(deps.playEffect).toHaveBeenCalledWith(tavern.effects[0])
  })

  it('ignores an Effect Hotkey when its Scene is not playing, with a debug line', async () => {
    const other = makeDeps({ playingSceneId: () => 'tavern', listScenes: vi.fn().mockResolvedValue([storm, scene('tavern', 'F15')]) })
    expect(await dispatchHotkey('F14', other)).toBe('ignored')
    const none = makeDeps()
    expect(await dispatchHotkey('F14', none)).toBe('ignored')
    expect(none.playEffect).not.toHaveBeenCalled()
    expect(none.logDebug).toHaveBeenCalled()
  })

  it('ignores an unknown accelerator', async () => {
    expect(await dispatchHotkey('F20', makeDeps())).toBe('ignored')
  })

  it('refuses with a toast when the Discord Target has no voice connection', async () => {
    const deps = makeDeps({ canPlay: () => false, activeTargetId: () => 'guild-1' })
    expect(await dispatchHotkey('F13', deps)).toBe('refused')
    expect(deps.refuse).toHaveBeenCalledOnce()
    expect(deps.playScene).not.toHaveBeenCalled()
    expect(deps.crossfadeToScene).not.toHaveBeenCalled()

    const effect = makeDeps({ canPlay: () => false, playingSceneId: () => 'storm' })
    expect(await dispatchHotkey('F14', effect)).toBe('refused')
    expect(effect.playEffect).not.toHaveBeenCalled()
  })

  it('still stops the Playing Scene without a voice connection', async () => {
    const deps = makeDeps({ canPlay: () => false, playingSceneId: () => 'storm' })
    expect(await dispatchHotkey('F13', deps)).toBe('stopped')
    expect(deps.refuse).not.toHaveBeenCalled()
  })

  it('logs the resolved action, Scene and Target at info', async () => {
    const deps = makeDeps({ activeTargetId: () => 'guild-1' })
    await dispatchHotkey('F13', deps)
    expect(deps.logInfo).toHaveBeenCalledWith(expect.stringContaining('F13'))
    expect(deps.logInfo).toHaveBeenCalledWith(expect.stringContaining('guild-1'))
  })

  it('reports a failure instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = makeDeps({ listScenes: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await dispatchHotkey('F13', deps)).toBe('failed')
  })
})
