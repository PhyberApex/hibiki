import type { Scene } from '../scenes/scene-store'
import { createLogger } from '../logger'
import { assertStopHotkeyAvailable, normalizeOptionalAccelerator } from '../scenes/hotkeys'

const log = createLogger('config')

const HOTKEYS_KEY = 'hotkeys'

export interface HotkeySettings {
  enabled: boolean
  stopHotkey?: string
}

export interface HotkeySettingsStore {
  get: (key: string) => Promise<string | null | undefined>
  set: (key: string, value: string) => Promise<void>
}

const DEFAULTS: HotkeySettings = { enabled: true }

function parse(raw: string | null | undefined): HotkeySettings {
  if (!raw)
    return { ...DEFAULTS }
  try {
    const data = JSON.parse(raw) as Partial<HotkeySettings> | null
    const settings: HotkeySettings = { enabled: typeof data?.enabled === 'boolean' ? data.enabled : DEFAULTS.enabled }
    const stopHotkey = normalizeOptionalAccelerator(data?.stopHotkey)
    if (stopHotkey)
      settings.stopHotkey = stopHotkey
    return settings
  }
  catch {
    return { ...DEFAULTS }
  }
}

export function createHotkeySettings(store: HotkeySettingsStore, listScenes: () => Promise<Scene[]>) {
  async function get(): Promise<HotkeySettings> {
    return parse(await store.get(HOTKEYS_KEY))
  }

  async function getStopHotkey(): Promise<string | undefined> {
    return (await get()).stopHotkey
  }

  async function set(input: HotkeySettings): Promise<void> {
    if (typeof input?.enabled !== 'boolean')
      throw new TypeError('Hotkey settings need an "enabled" boolean')
    const next: HotkeySettings = { enabled: input.enabled }
    const stopHotkey = normalizeOptionalAccelerator(input.stopHotkey)
    if (stopHotkey) {
      try {
        assertStopHotkeyAvailable(stopHotkey, await listScenes())
      }
      catch (e) {
        log.info(`Rejected Stop Hotkey: ${(e as Error).message}`)
        throw e
      }
      next.stopHotkey = stopHotkey
    }
    await store.set(HOTKEYS_KEY, JSON.stringify(next))
    log.info(`Hotkey settings: global hotkeys ${next.enabled ? 'enabled' : 'disabled'}, Stop Hotkey ${next.stopHotkey ?? 'unset'}`)
  }

  return { get, getStopHotkey, set }
}
