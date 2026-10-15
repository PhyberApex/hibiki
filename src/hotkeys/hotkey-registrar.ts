import type { HotkeySettings } from '../config/hotkey-settings'
import type { Scene } from '../scenes/scene-store'
import { createLogger } from '../logger'

const log = createLogger('hotkeys')

/** Every accelerator wanted right now, with a human description of each binding that owns it. */
export function computeAccelerators(scenes: Scene[], settings: HotkeySettings): Map<string, string[]> {
  const wanted = new Map<string, string[]>()
  const add = (accelerator: string | undefined, owner: string) => {
    if (!accelerator)
      return
    const owners = wanted.get(accelerator)
    if (owners)
      owners.push(owner)
    else
      wanted.set(accelerator, [owner])
  }
  for (const scene of scenes) {
    add(scene.hotkey, `Scene "${scene.name}"`)
    for (const effect of scene.effects)
      add(effect.hotkey, `Effect "${effect.soundName ?? effect.soundId}" in Scene "${scene.name}"`)
  }
  add(settings.stopHotkey, 'Stop Hotkey')
  return wanted
}

export interface HotkeyFailure {
  accelerator: string
  owner: string
  reason: string
}

export interface HotkeyStatus {
  enabled: boolean
  registered: string[]
  failures: HotkeyFailure[]
}

export interface ShortcutDriver {
  /** Returns whether the OS granted the key; may throw where the platform has no global shortcuts. */
  register: (accelerator: string, callback: () => void) => boolean
  unregister: (accelerator: string) => void
}

const REFUSED_REASON = 'another application already uses this key, or this platform does not support global shortcuts (for example Wayland)'

/**
 * Keeps the OS-level registrations in step with the wanted accelerators, touching only what changed.
 * Knows nothing about Electron: the driver wraps `globalShortcut`.
 */
export function createHotkeyRegistrar(driver: ShortcutDriver, onFire: (accelerator: string) => void) {
  const registered = new Set<string>()
  let failures: HotkeyFailure[] = []
  let enabled = false

  function release(accelerator: string, owners: string) {
    try {
      driver.unregister(accelerator)
      log.info(`Unregistered ${accelerator} (${owners})`)
    }
    catch (e) {
      log.warn(`Could not unregister ${accelerator}:`, e)
    }
    registered.delete(accelerator)
  }

  const lastOwners = new Map<string, string>()

  function acquire(accelerator: string, owners: string[]): HotkeyFailure[] {
    const joined = owners.join(', ')
    let reason: string | null = null
    try {
      if (!driver.register(accelerator, () => onFire(accelerator)))
        reason = REFUSED_REASON
    }
    catch (e) {
      reason = `${(e as Error)?.message ?? e}`
    }
    if (reason === null) {
      registered.add(accelerator)
      lastOwners.set(accelerator, joined)
      log.info(`Registered ${accelerator} (${joined})`)
      return []
    }
    log.warn(`Could not register ${accelerator} for ${joined}: ${reason}`)
    return owners.map(owner => ({ accelerator, owner, reason }))
  }

  /** Makes the registrations match `wanted` (empty when `isEnabled` is false). Accelerators that already hold are left alone. */
  function sync(wanted: Map<string, string[]>, isEnabled: boolean): void {
    enabled = isEnabled
    const target = isEnabled ? wanted : new Map<string, string[]>()
    for (const accelerator of [...registered]) {
      if (!target.has(accelerator)) {
        release(accelerator, lastOwners.get(accelerator) ?? '')
        lastOwners.delete(accelerator)
      }
    }
    const next: HotkeyFailure[] = []
    for (const [accelerator, owners] of target) {
      if (registered.has(accelerator)) {
        lastOwners.set(accelerator, owners.join(', '))
        continue
      }
      next.push(...acquire(accelerator, owners))
    }
    failures = next
  }

  function releaseAll(): void {
    sync(new Map(), false)
  }

  function getStatus(): HotkeyStatus {
    return { enabled, registered: [...registered], failures: failures.map(f => ({ ...f })) }
  }

  return { sync, releaseAll, getStatus }
}
