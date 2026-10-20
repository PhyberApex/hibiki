import { checkForUpdate, dismissUpdate } from '@/api/updates'
import { logInfo } from '@/audio/audio-element-diagnostics'
import { useToastStore } from '@/stores/toast'

/**
 * The launch update notice: asks the backend once whether a newer release
 * exists and, if so, shows a toast that stays until the GM dismisses it.
 * Dismissing remembers the version so the next launch stays quiet about it.
 * Fire-and-forget from `App.vue`; never throws.
 */
export async function showUpdateNotice(): Promise<void> {
  try {
    const update = await checkForUpdate()
    if (!update)
      return
    logInfo(`[updates] Showing the update notice for ${update.version}`)
    useToastStore().show({
      type: 'info',
      text: `Hibiki ${update.version} is available.`,
      durationMs: null,
      key: 'update-notice',
      link: { label: 'View release', url: update.url },
      onDismiss: () => {
        dismissUpdate(update.version).catch(e => console.error('[updates] Could not remember the dismissed update:', e))
      },
    })
  }
  catch (e) {
    console.error('[updates] Update check failed:', e)
  }
}
