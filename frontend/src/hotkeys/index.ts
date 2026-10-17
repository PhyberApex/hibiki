import { fetchHotkeySettings } from '@/api/config'
import { fetchHotkeyStatus, onHotkeyFired } from '@/api/hotkeys'
import { listScenes } from '@/api/scenes'
import { logInfo } from '@/audio/audio-element-diagnostics'
import { usePlayerStore } from '@/stores/player'
import { useScenePlaybackStore } from '@/stores/scene-playback'
import { useToastStore } from '@/stores/toast'
import { dispatchHotkey } from './dispatch'

/** One grouped warning for every key the OS refused at startup (details are in the log and Settings). */
export async function reportHotkeyRegistrationFailures(): Promise<void> {
  const toast = useToastStore()
  try {
    const { failures } = await fetchHotkeyStatus()
    if (failures.length === 0)
      return
    const keys = [...new Set(failures.map(f => f.accelerator))]
    toast.show({
      type: 'warning',
      text: `Global hotkeys could not be registered: ${keys.join(', ')}. Another app may hold them, or this system does not support global hotkeys.`,
      durationMs: 10_000,
    })
  }
  catch (e) {
    console.error('[hotkeys] Could not read registration status:', e)
  }
}

/** Starts resolving fired hotkeys into playback actions for the app's lifetime; returns a stop function. */
export function startHotkeyDispatch(): () => void {
  const player = usePlayerStore()
  const playback = useScenePlaybackStore()
  const toast = useToastStore()

  // One press at a time: a second press must see the first one's effect on the Playing Scene.
  let chain: Promise<unknown> = Promise.resolve()

  return onHotkeyFired((accelerator) => {
    chain = chain.then(() => dispatchHotkey(accelerator, {
      listScenes,
      getActionHotkeys: async () => {
        const { enabled: _enabled, ...actionHotkeys } = await fetchHotkeySettings()
        return actionHotkeys
      },
      playingSceneId: () => player.playingSceneId,
      activeTargetId: () => player.targetId,
      canPlay: () => player.canPlay,
      playScene: playback.playScene,
      crossfadeToScene: playback.crossfadeToScene,
      stopScene: playback.stopScene,
      activeEffectCount: player.activeEffectCount,
      stopAllEffects: playback.stopAllEffectInstances,
      stepMasterVolume: playback.stepMasterVolume,
      showVolume: percent => toast.show({ type: 'info', key: 'master-volume', text: `Master volume ${percent}%` }),
      playEffect: playback.playEffect,
      refuse: text => toast.show({ type: 'warning', text }),
      logInfo,
      // Renderer debug output never reaches hibiki.log, and this is the line that explains "nothing happened".
      logDebug: logInfo,
    }))
  })
}
