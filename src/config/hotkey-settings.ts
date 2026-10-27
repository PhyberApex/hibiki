import type { ActionHotkeys } from '../scenes/hotkeys'
import type { Scene } from '../scenes/scene-store'
import { createLogger } from '../logger'
import { ACTION_HOTKEYS, assertActionHotkeyAvailable, normalizeOptionalAccelerator } from '../scenes/hotkeys'

const log = createLogger('config')

const HOTKEYS_KEY = 'hotkeys'

export interface HotkeySettings extends ActionHotkeys {
  enabled: boolean
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
    const settings: HotkeySettings = {
      enabled: typeof data?.enabled === 'boolean'
        ? data.enabled
        : DEFAULTS.enabled,
    }
    for (const { field } of ACTION_HOTKEYS) {
      const accelerator = normalizeOptionalAccelerator(data?.[field])
      if (accelerator)
        settings[field] = accelerator
    }
    return settings
  }
  catch (e) {
    log.warn('Stored hotkey settings are unreadable; using defaults:', e)
    return { ...DEFAULTS }
  }
}

export function createHotkeySettings(store: HotkeySettingsStore, listScenes: () => Promise<Scene[]>) {
  async function get(): Promise<HotkeySettings> {
    return parse(await store.get(HOTKEYS_KEY))
  }

  async function getActionHotkeys(): Promise<ActionHotkeys> {
    const { enabled: _enabled, ...actionHotkeys } = await get()
    return actionHotkeys
  }

  async function set(input: HotkeySettings): Promise<void> {
    if (typeof input?.enabled !== 'boolean')
      throw new TypeError('Hotkey settings need an "enabled" boolean')
    const next: HotkeySettings = { enabled: input.enabled }
    const scenes = await listScenes()
    for (const { field } of ACTION_HOTKEYS) {
      const accelerator = normalizeOptionalAccelerator(input[field])
      if (accelerator)
        next[field] = accelerator
    }
    for (const { field, owner } of ACTION_HOTKEYS) {
      const accelerator = next[field]
      if (!accelerator)
        continue
      try {
        assertActionHotkeyAvailable(field, accelerator, scenes, next)
      }
      catch (e) {
        log.info(`Rejected ${owner.replace(/^the /, '')}: ${(e as Error).message}`)
        throw e
      }
    }
    await store.set(HOTKEYS_KEY, JSON.stringify(next))
    log.info(`Hotkey settings: global hotkeys ${next.enabled ? 'enabled' : 'disabled'}, ${ACTION_HOTKEYS.map(a => `${a.owner.replace(/^the /, '')} ${next[a.field] ?? 'unset'}`).join(', ')}`)
  }

  return { get, getActionHotkeys, set }
}
