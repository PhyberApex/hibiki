import type { HotkeySettings } from '@/api/config'
import type { Scene, SceneItem } from '@/api/scenes'

/** Everything the dispatcher needs from the app, injected so it can be tested without stores or IPC. */
export interface HotkeyDeps {
  listScenes: () => Promise<Scene[]>
  getActionHotkeys: () => Promise<Omit<HotkeySettings, 'enabled'>>
  playingSceneId: () => string | null
  activeTargetId: () => string | null
  /** True when the active Target can play right now (always for Local, joined channel for Discord). */
  canPlay: () => boolean
  /** Starts the Scene; resolves once it is the Playing Scene, not once every element is playable (#714). */
  playScene: (scene: Scene) => Promise<void>
  crossfadeToScene: (sceneId: string) => Promise<void>
  stopScene: () => void
  activeEffectCount: () => number
  stopAllEffects: () => void
  /** Moves the active Target's master volume and persists it; resolves to the new volume, or null at the bound. */
  stepMasterVolume: (delta: number) => Promise<number | null>
  showVolume: (percent: number) => void
  playEffect: (item: SceneItem) => Promise<void>
  /** Shows the user a refusal (a warning toast, which the renderer also writes to the log at warn). */
  refuse: (text: string) => void
  logInfo: (message: string) => void
  logDebug: (message: string) => void
  /** Usage Stats: the press resolved to a binding of this kind (never the key itself). */
  trackFired: (kind: HotkeyKind) => void
}

export type HotkeyKind = 'scene' | 'effect' | 'action'

export type HotkeyOutcome = 'played' | 'crossfaded' | 'stopped' | 'volume' | 'effect' | 'ignored' | 'refused' | 'failed'

/** Master volume change per Volume Up / Volume Down press. */
export const VOLUME_STEP = 5

const NOT_CONNECTED_TEXT = 'Hotkey ignored: Discord is the active output but no voice channel is joined. Join a channel or switch to Local.'

/**
 * Resolves a fired accelerator against the current Scenes (ADR-0005): an Action Hotkey runs its fixed action (stop the Playing Scene or all Effects, step the master volume, move to the previous or next Scene),
 * a Scene Hotkey toggles its Scene, an Effect Hotkey triggers only within the Playing Scene. Always acts on the
 * active Output Target; never joins a channel or falls back to Local.
 */
export async function dispatchHotkey(accelerator: string, deps: HotkeyDeps): Promise<HotkeyOutcome> {
  const target = deps.activeTargetId() ?? 'none'
  const log = (action: string, sceneId: string | null, outcome: HotkeyOutcome) =>
    deps.logInfo(`[hotkeys] ${accelerator} -> ${action}, Scene ${sceneId ?? 'none'}, Target ${target}: ${outcome}`)

  const refuse = (action: string, sceneId: string): HotkeyOutcome => {
    log(action, sceneId, 'refused')
    deps.refuse(NOT_CONNECTED_TEXT)
    return 'refused'
  }

  try {
    const [scenes, actionHotkeys] = await Promise.all([
      deps.listScenes(),
      deps.getActionHotkeys(),
    ])
    const playingId = deps.playingSceneId()

    if (actionHotkeys.stopHotkey === accelerator) {
      deps.trackFired('action')
      if (!playingId) {
        log('stop', null, 'ignored')
        return 'ignored'
      }
      deps.stopScene()
      log('stop', playingId, 'stopped')
      return 'stopped'
    }

    if (actionHotkeys.stopEffectsHotkey === accelerator) {
      deps.trackFired('action')
      if (deps.activeEffectCount() === 0) {
        deps.logDebug(`[hotkeys] ${accelerator} -> stop all Effects, Target ${target}: ignored, no Effect is playing`)
        return 'ignored'
      }
      deps.stopAllEffects()
      log('stop all Effects', playingId, 'stopped')
      return 'stopped'
    }

    const volumeStep = actionHotkeys.volumeUpHotkey === accelerator
      ? VOLUME_STEP
      : actionHotkeys.volumeDownHotkey === accelerator
        ? -VOLUME_STEP
        : 0
    if (volumeStep) {
      deps.trackFired('action')
      const action = volumeStep > 0
        ? 'volume up'
        : 'volume down'
      const volume = await deps.stepMasterVolume(volumeStep)
      if (volume === null) {
        deps.logDebug(`[hotkeys] ${accelerator} -> ${action}, Target ${target}: ignored, master volume already at the limit`)
        return 'ignored'
      }
      deps.showVolume(volume)
      log(`${action} to ${volume}%`, playingId, 'volume')
      return 'volume'
    }

    const direction = actionHotkeys.nextSceneHotkey === accelerator
      ? 1
      : actionHotkeys.previousSceneHotkey === accelerator
        ? -1
        : 0
    if (direction) {
      deps.trackFired('action')
      const action = direction > 0
        ? 'next Scene'
        : 'previous Scene'
      const currentIndex = playingId
        ? scenes.findIndex(s => s.id === playingId)
        : -1
      const destination = currentIndex === -1
        ? (direction > 0
            ? scenes[0]
            : scenes[scenes.length - 1])
        : scenes[currentIndex + direction]
      if (!destination) {
        deps.logDebug(`[hotkeys] ${accelerator} -> ${action}, Scene ${playingId ?? 'none'}, Target ${target}: ignored, ${currentIndex === -1
          ? 'no Scenes'
          : 'no Scene beyond the end of the list'}`)
        return 'ignored'
      }
      if (!deps.canPlay())
        return refuse(action, destination.id)
      if (currentIndex === -1) {
        await deps.playScene(destination)
        log(action, destination.id, 'played')
        return 'played'
      }
      await deps.crossfadeToScene(destination.id)
      log(action, destination.id, 'crossfaded')
      return 'crossfaded'
    }

    const scene = scenes.find(s => s.hotkey === accelerator)
    if (scene) {
      deps.trackFired('scene')
      if (playingId === scene.id) {
        deps.stopScene()
        log('toggle Scene', scene.id, 'stopped')
        return 'stopped'
      }
      if (!deps.canPlay())
        return refuse('play Scene', scene.id)
      if (playingId) {
        await deps.crossfadeToScene(scene.id)
        log('crossfade to Scene', scene.id, 'crossfaded')
        return 'crossfaded'
      }
      await deps.playScene(scene)
      log('play Scene', scene.id, 'played')
      return 'played'
    }

    const playing = playingId
      ? scenes.find(s => s.id === playingId)
      : undefined
    const effect = playing?.effects.find(e => e.hotkey === accelerator)
    if (!playing || !effect) {
      deps.logDebug(`[hotkeys] ${accelerator} ignored: no Scene or Stop binding, and no Effect in the Playing Scene (${playingId ?? 'none'})`)
      return 'ignored'
    }
    deps.trackFired('effect')
    if (!deps.canPlay())
      return refuse('play Effect', playing.id)
    await deps.playEffect(effect)
    log(`play Effect ${effect.soundId}`, playing.id, 'effect')
    return 'effect'
  }
  catch (e) {
    console.error(`[hotkeys] ${accelerator} failed:`, e)
    return 'failed'
  }
}
