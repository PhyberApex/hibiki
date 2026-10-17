import type { Scene } from '../scenes/scene-store'
import { createHotkeySettings } from './hotkey-settings'

function scene(partial: Partial<Scene>): Scene {
  return { id: 's', name: 'Tavern', ambience: [], music: [], effects: [], createdAt: '', updatedAt: '', ...partial }
}

function setup(scenes: Scene[] = [], initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const settings = createHotkeySettings(
    { get: async k => data.get(k) ?? null, set: async (k, v) => { data.set(k, v) } },
    async () => scenes,
  )
  return { data, settings }
}

describe('hotkey settings', () => {
  it('defaults to enabled with no Stop Hotkey', async () => {
    expect(await setup().settings.get()).toEqual({ enabled: true })
  })

  it('falls back to defaults on corrupt stored values', async () => {
    expect(await setup([], { hotkeys: 'garbage' }).settings.get()).toEqual({ enabled: true })
  })

  it('persists the toggle and a normalised Stop Hotkey', async () => {
    const { settings } = setup()
    await settings.set({ enabled: false, stopHotkey: 'shift+ctrl+s' })
    expect(await settings.get()).toEqual({ enabled: false, stopHotkey: 'Ctrl+Shift+S' })
    expect(await settings.getActionHotkeys()).toEqual({ stopHotkey: 'Ctrl+Shift+S' })
  })

  it('clears the Stop Hotkey when omitted', async () => {
    const { settings } = setup()
    await settings.set({ enabled: true, stopHotkey: 'F12' })
    await settings.set({ enabled: true })
    expect(await settings.get()).toEqual({ enabled: true })
  })

  it('rejects a Stop Hotkey held by a Scene, naming it', async () => {
    const { settings, data } = setup([scene({ hotkey: 'F1' })])
    await expect(settings.set({ enabled: true, stopHotkey: 'f1' })).rejects.toThrow('Scene "Tavern"')
    expect(data.has('hotkeys')).toBe(false)
  })

  it('rejects a Stop Hotkey held by an Effect in any Scene', async () => {
    const { settings } = setup([scene({ effects: [{ soundId: 'x', soundName: 'Boom', hotkey: 'F2' }] })])
    await expect(settings.set({ enabled: true, stopHotkey: 'F2' })).rejects.toThrow('Effect "Boom" in Scene "Tavern"')
  })

  it('rejects non-boolean enabled', async () => {
    await expect(setup().settings.set({} as never)).rejects.toThrow('enabled')
  })

  it('persists every Action Hotkey, normalised', async () => {
    const { settings } = setup()
    await settings.set({
      enabled: true,
      stopHotkey: 'F1',
      stopEffectsHotkey: 'f2',
      previousSceneHotkey: 'f3',
      nextSceneHotkey: 'f4',
      volumeDownHotkey: 'f5',
      volumeUpHotkey: 'f6',
    })
    expect(await settings.getActionHotkeys()).toEqual({
      stopHotkey: 'F1',
      stopEffectsHotkey: 'F2',
      previousSceneHotkey: 'F3',
      nextSceneHotkey: 'F4',
      volumeDownHotkey: 'F5',
      volumeUpHotkey: 'F6',
    })
  })

  it('rejects an Action Hotkey already held by another Action Hotkey, naming it', async () => {
    const { settings, data } = setup()
    await expect(settings.set({ enabled: true, stopHotkey: 'F1', volumeUpHotkey: 'f1' })).rejects.toThrow('the Volume Up Hotkey')
    expect(data.has('hotkeys')).toBe(false)
  })

  it('rejects an Action Hotkey held by a Scene or Effect', async () => {
    const { settings } = setup([scene({ hotkey: 'F1', effects: [{ soundId: 'x', soundName: 'Boom', hotkey: 'F2' }] })])
    await expect(settings.set({ enabled: true, nextSceneHotkey: 'F1' })).rejects.toThrow('Scene "Tavern"')
    await expect(settings.set({ enabled: true, volumeDownHotkey: 'F2' })).rejects.toThrow('Effect "Boom"')
  })
})
