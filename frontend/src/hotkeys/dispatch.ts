import type { Scene, SceneItem } from '@/api/scenes'

/** Everything the dispatcher needs from the app, injected so it can be tested without stores or IPC. */
export interface HotkeyDeps {
  listScenes: () => Promise<Scene[]>
  getStopHotkey: () => Promise<string | undefined>
  playingSceneId: () => string | null
  activeTargetId: () => string | null
  /** True when the active Target can play right now (always for Local, joined channel for Discord). */
  canPlay: () => boolean
  playScene: (scene: Scene) => Promise<void>
  crossfadeToScene: (sceneId: string) => Promise<void>
  stopScene: () => void
  playEffect: (item: SceneItem) => Promise<void>
  /** Shows the user a refusal. */
  refuse: (text: string) => void
  logInfo: (message: string) => void
  logDebug: (message: string) => void
}

export type HotkeyOutcome = 'played' | 'crossfaded' | 'stopped' | 'effect' | 'ignored' | 'refused' | 'failed'

const NOT_CONNECTED_TEXT = 'Hotkey ignored: Discord is the active output but no voice channel is joined. Join a channel or switch to Local.'

/**
 * Resolves a fired accelerator against the current Scenes (ADR-0005): the Stop Hotkey stops the Playing Scene,
 * a Scene Hotkey toggles its Scene, an Effect Hotkey triggers only within the Playing Scene. Always acts on the
 * active Output Target; never joins a channel or falls back to Local.
 */
export async function dispatchHotkey(accelerator: string, deps: HotkeyDeps): Promise<HotkeyOutcome> {
  const target = deps.activeTargetId() ?? 'none'
  const log = (action: string, sceneId: string | null, outcome: HotkeyOutcome) =>
    deps.logInfo(`[hotkeys] ${accelerator} -> ${action}, Scene ${sceneId ?? 'none'}, Target ${target}: ${outcome}`)

  try {
    const [scenes, stopHotkey] = await Promise.all([deps.listScenes(), deps.getStopHotkey()])
    const playingId = deps.playingSceneId()

    if (stopHotkey === accelerator) {
      if (!playingId) {
        log('stop', null, 'ignored')
        return 'ignored'
      }
      deps.stopScene()
      log('stop', playingId, 'stopped')
      return 'stopped'
    }

    const scene = scenes.find(s => s.hotkey === accelerator)
    if (scene) {
      if (playingId === scene.id) {
        deps.stopScene()
        log('toggle Scene', scene.id, 'stopped')
        return 'stopped'
      }
      if (!deps.canPlay()) {
        log('play Scene', scene.id, 'refused')
        console.warn(`[hotkeys] ${accelerator} refused: no voice connection on Target ${target}`)
        deps.refuse(NOT_CONNECTED_TEXT)
        return 'refused'
      }
      if (playingId) {
        await deps.crossfadeToScene(scene.id)
        log('crossfade to Scene', scene.id, 'crossfaded')
        return 'crossfaded'
      }
      await deps.playScene(scene)
      log('play Scene', scene.id, 'played')
      return 'played'
    }

    const playing = playingId ? scenes.find(s => s.id === playingId) : undefined
    const effect = playing?.effects.find(e => e.hotkey === accelerator)
    if (!playing || !effect) {
      deps.logDebug(`[hotkeys] ${accelerator} ignored: no Scene or Stop binding, and no Effect in the Playing Scene (${playingId ?? 'none'})`)
      return 'ignored'
    }
    if (!deps.canPlay()) {
      log('play Effect', playing.id, 'refused')
      console.warn(`[hotkeys] ${accelerator} refused: no voice connection on Target ${target}`)
      deps.refuse(NOT_CONNECTED_TEXT)
      return 'refused'
    }
    await deps.playEffect(effect)
    log(`play Effect ${effect.soundId}`, playing.id, 'effect')
    return 'effect'
  }
  catch (e) {
    console.error(`[hotkeys] ${accelerator} failed:`, e)
    return 'failed'
  }
}
