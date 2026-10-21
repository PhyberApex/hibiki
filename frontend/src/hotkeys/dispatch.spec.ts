import type { HotkeyDeps, HotkeyKind } from './dispatch'
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
    getActionHotkeys: vi.fn().mockResolvedValue({
      stopHotkey: 'F16',
      stopEffectsHotkey: 'F17',
      previousSceneHotkey: 'F18',
      nextSceneHotkey: 'F19',
      volumeDownHotkey: 'F20',
      volumeUpHotkey: 'F21',
    }),
    playingSceneId: () => null,
    activeTargetId: () => 'local',
    canPlay: () => true,
    playScene: vi.fn().mockResolvedValue(undefined),
    crossfadeToScene: vi.fn().mockResolvedValue(undefined),
    stopScene: vi.fn(),
    activeEffectCount: () => 2,
    stopAllEffects: vi.fn(),
    stepMasterVolume: vi.fn().mockResolvedValue(65),
    showVolume: vi.fn(),
    playEffect: vi.fn().mockResolvedValue(undefined),
    refuse: vi.fn(),
    logInfo: vi.fn(),
    logDebug: vi.fn(),
    trackFired: vi.fn(),
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
    expect(await dispatchHotkey('F30', makeDeps())).toBe('ignored')
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

  describe('action Hotkeys', () => {
    it('stop all Effects ends instances whether or not a Scene plays', async () => {
      const deps = makeDeps()
      expect(await dispatchHotkey('F17', deps)).toBe('stopped')
      expect(deps.stopAllEffects).toHaveBeenCalled()
    })

    it('stop all Effects is a debug-logged no-op without instances', async () => {
      const deps = makeDeps({ activeEffectCount: () => 0 })
      expect(await dispatchHotkey('F17', deps)).toBe('ignored')
      expect(deps.stopAllEffects).not.toHaveBeenCalled()
      expect(deps.logDebug).toHaveBeenCalled()
    })

    it('volume Up / Down step by 5 and show the new volume', async () => {
      const deps = makeDeps()
      expect(await dispatchHotkey('F21', deps)).toBe('volume')
      expect(deps.stepMasterVolume).toHaveBeenCalledWith(5)
      expect(deps.showVolume).toHaveBeenCalledWith(65)
      await dispatchHotkey('F20', deps)
      expect(deps.stepMasterVolume).toHaveBeenLastCalledWith(-5)
    })

    it('volume at the bound is a silent no-op', async () => {
      const deps = makeDeps({ stepMasterVolume: vi.fn().mockResolvedValue(null) })
      expect(await dispatchHotkey('F21', deps)).toBe('ignored')
      expect(deps.showVolume).not.toHaveBeenCalled()
      expect(deps.logDebug).toHaveBeenCalled()
    })

    it('volume applies even when canPlay is false', async () => {
      const deps = makeDeps({ canPlay: () => false })
      expect(await dispatchHotkey('F21', deps)).toBe('volume')
      expect(deps.refuse).not.toHaveBeenCalled()
    })

    it('next crossfades from the Playing Scene to the following Scene', async () => {
      const deps = makeDeps({ playingSceneId: () => 'storm' })
      expect(await dispatchHotkey('F19', deps)).toBe('crossfaded')
      expect(deps.crossfadeToScene).toHaveBeenCalledWith('tavern')
    })

    it('previous crossfades backwards', async () => {
      const deps = makeDeps({ playingSceneId: () => 'tavern' })
      expect(await dispatchHotkey('F18', deps)).toBe('crossfaded')
      expect(deps.crossfadeToScene).toHaveBeenCalledWith('storm')
    })

    it('does not wrap at either end', async () => {
      const last = makeDeps({ playingSceneId: () => 'tavern' })
      expect(await dispatchHotkey('F19', last)).toBe('ignored')
      const first = makeDeps({ playingSceneId: () => 'storm' })
      expect(await dispatchHotkey('F18', first)).toBe('ignored')
      expect(last.crossfadeToScene).not.toHaveBeenCalled()
      expect(first.crossfadeToScene).not.toHaveBeenCalled()
    })

    it('with no Playing Scene, Next starts the first and Previous the last', async () => {
      const next = makeDeps()
      expect(await dispatchHotkey('F19', next)).toBe('played')
      expect(next.playScene).toHaveBeenCalledWith(storm)
      const previous = makeDeps()
      expect(await dispatchHotkey('F18', previous)).toBe('played')
      expect(previous.playScene).toHaveBeenCalledWith(tavern)
    })

    it('is refused under Discord without a channel', async () => {
      const deps = makeDeps({ canPlay: () => false })
      expect(await dispatchHotkey('F19', deps)).toBe('refused')
      expect(deps.refuse).toHaveBeenCalled()
      expect(deps.playScene).not.toHaveBeenCalled()
    })
  })

  describe('usage stats', () => {
    const stormPlaying: Partial<HotkeyDeps> = { playingSceneId: () => 'storm' }
    it.each<[string, string, Partial<HotkeyDeps>, HotkeyKind]>([
      ['a Scene Hotkey', 'F13', {}, 'scene'],
      ['an Effect Hotkey', 'F14', stormPlaying, 'effect'],
      ['the Stop Hotkey', 'F16', stormPlaying, 'action'],
      ['the Stop all Effects Hotkey', 'F17', {}, 'action'],
      ['Next Scene', 'F19', {}, 'action'],
      ['Volume Up', 'F21', {}, 'action'],
    ])('reports %s by kind only', async (_name, accelerator, overrides, kind) => {
      const deps = makeDeps(overrides)
      await dispatchHotkey(accelerator, deps)
      expect(deps.trackFired).toHaveBeenCalledTimes(1)
      expect(deps.trackFired).toHaveBeenCalledWith(kind)
    })

    it('reports a bound press even when it is refused', async () => {
      const deps = makeDeps({ canPlay: () => false })
      expect(await dispatchHotkey('F13', deps)).toBe('refused')
      expect(deps.trackFired).toHaveBeenCalledWith('scene')
    })

    it('reports nothing for a key that resolves to no binding', async () => {
      const deps = makeDeps()
      expect(await dispatchHotkey('F14', deps)).toBe('ignored')
      expect(deps.trackFired).not.toHaveBeenCalled()
    })
  })
})
