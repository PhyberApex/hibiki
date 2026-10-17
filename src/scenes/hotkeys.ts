import type { Scene, SceneItem } from './scene-store'

const MODIFIER_ALIASES: Record<string, string> = {
  cmdorctrl: 'CmdOrCtrl',
  commandorcontrol: 'CmdOrCtrl',
  cmd: 'Cmd',
  command: 'Cmd',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
}

const MODIFIER_ORDER = ['CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'AltGr', 'Shift', 'Super']

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  return: 'Enter',
  del: 'Delete',
  ins: 'Insert',
  spacebar: 'Space',
}

/** Multi-word Electron key codes whose canonical spelling is camel-cased. */
const CAMEL_KEYS = ['PageUp', 'PageDown', 'PrintScreen', 'NumLock', 'ScrollLock', 'CapsLock', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'VolumeUp', 'VolumeDown', 'VolumeMute']
const CAMEL_KEY_LOOKUP = new Map(CAMEL_KEYS.map(k => [k.toLowerCase(), k]))

function normalizeKey(key: string): string {
  if (key.length === 1)
    return key.toUpperCase()
  const lower = key.toLowerCase()
  return KEY_ALIASES[lower] ?? CAMEL_KEY_LOOKUP.get(lower) ?? (lower[0].toUpperCase() + lower.slice(1))
}

/**
 * Canonical form of an Electron accelerator: aliases resolved, modifiers deduplicated and in a fixed
 * order, key capitalised. Two strings naming the same key combination normalise to the same value.
 */
export function normalizeAccelerator(input: string): string {
  const parts = input.split('+').map(p => p.trim())
  // A literal "+" key is written "Ctrl++": the split leaves two empty tails.
  const plusKey = parts.length >= 2 && parts[parts.length - 1] === '' && parts[parts.length - 2] === ''
  const tokens = plusKey ? [...parts.slice(0, -2), '+'] : parts
  if (tokens.length === 0 || tokens.includes(''))
    throw new Error(`Invalid hotkey "${input}"`)

  const key = tokens[tokens.length - 1]
  if (key.toLowerCase() in MODIFIER_ALIASES)
    throw new Error(`Invalid hotkey "${input}": missing a key`)

  const modifiers = new Set<string>()
  for (const token of tokens.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()]
    if (!modifier)
      throw new Error(`Invalid hotkey "${input}": unknown modifier "${token}"`)
    modifiers.add(modifier)
  }
  const ordered = MODIFIER_ORDER.filter(m => modifiers.has(m))
  return [...ordered, normalizeKey(key)].join('+')
}

/** Empty or missing means "no hotkey". */
export function normalizeOptionalAccelerator(input: unknown): string | undefined {
  if (input === undefined || input === null)
    return undefined
  if (typeof input !== 'string')
    throw new Error('Hotkey must be a string')
  if (input.trim() === '')
    return undefined
  return normalizeAccelerator(input)
}

function describeEffect(item: SceneItem, scene: Scene): string {
  return `Effect "${item.soundName ?? item.soundId}" in Scene "${scene.name}"`
}

function rejection(key: string, owner: string): Error {
  return new Error(`Hotkey ${key} is already used by ${owner}`)
}

/** The Action Hotkeys (CONTEXT.md): each is bound to one fixed app action and stored in the hotkey settings. */
export const ACTION_HOTKEYS = [
  { field: 'stopHotkey', owner: 'the Stop Hotkey' },
  { field: 'stopEffectsHotkey', owner: 'the Stop all Effects Hotkey' },
  { field: 'previousSceneHotkey', owner: 'the Previous Scene Hotkey' },
  { field: 'nextSceneHotkey', owner: 'the Next Scene Hotkey' },
  { field: 'volumeDownHotkey', owner: 'the Volume Down Hotkey' },
  { field: 'volumeUpHotkey', owner: 'the Volume Up Hotkey' },
] as const

export type ActionHotkeyField = typeof ACTION_HOTKEYS[number]['field']
export type ActionHotkeys = Partial<Record<ActionHotkeyField, string>>

function actionHotkeyOwner(key: string, actionHotkeys: ActionHotkeys, except?: ActionHotkeyField): string | undefined {
  return ACTION_HOTKEYS.find(a => a.field !== except && actionHotkeys[a.field] === key)?.owner
}

/** Rejects a Scene whose Hotkeys clash with each other, with another Scene's, or with an Action Hotkey. */
export function assertSceneHotkeysAvailable(candidate: Scene, others: Scene[], actionHotkeys: ActionHotkeys = {}): void {
  const sceneKey = candidate.hotkey
  if (sceneKey) {
    const action = actionHotkeyOwner(sceneKey, actionHotkeys)
    if (action)
      throw rejection(sceneKey, action)
    for (const other of others) {
      if (other.hotkey === sceneKey)
        throw rejection(sceneKey, `Scene "${other.name}"`)
      const effect = other.effects.find(e => e.hotkey === sceneKey)
      if (effect)
        throw rejection(sceneKey, describeEffect(effect, other))
    }
  }

  const seen = new Map<string, SceneItem>()
  for (const item of candidate.effects) {
    const key = item.hotkey
    if (!key)
      continue
    const earlier = seen.get(key)
    if (earlier)
      throw rejection(key, describeEffect(earlier, candidate))
    seen.set(key, item)
    if (key === sceneKey)
      throw rejection(key, `Scene "${candidate.name}"`)
    const action = actionHotkeyOwner(key, actionHotkeys)
    if (action)
      throw rejection(key, action)
    const owner = others.find(o => o.hotkey === key)
    if (owner)
      throw rejection(key, `Scene "${owner.name}"`)
  }
}

/** Rejects an Action Hotkey already held by any Scene, any Effect or another Action Hotkey. */
export function assertActionHotkeyAvailable(field: ActionHotkeyField, key: string, scenes: Scene[], actionHotkeys: ActionHotkeys): void {
  const action = actionHotkeyOwner(key, actionHotkeys, field)
  if (action)
    throw rejection(key, action)
  for (const scene of scenes) {
    if (scene.hotkey === key)
      throw rejection(key, `Scene "${scene.name}"`)
    const effect = scene.effects.find(e => e.hotkey === key)
    if (effect)
      throw rejection(key, describeEffect(effect, scene))
  }
}
