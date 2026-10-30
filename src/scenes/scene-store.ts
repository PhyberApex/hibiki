import type { Config } from '../config'
import type { SoundCategory } from '../sound/sound.types'
import type { ActionHotkeys } from './hotkeys'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { createJsonFileStore } from '../json-file'
import { createLogger } from '../logger'
import { isSafeSoundId, SOUND_CATEGORIES } from '../sound/sound-id'
import { assertSceneHotkeysAvailable, normalizeOptionalAccelerator } from './hotkeys'

export interface SoundSource {
  name: string
  url?: string
  note?: string
}

export interface SceneItem {
  soundId: string
  soundName?: string
  volume?: number
  enabled?: boolean
  loop?: boolean
  /** Ambience repeat interval in seconds, set by the renderer; both 0 (or absent) loops seamlessly. */
  repeatMin?: number
  repeatMax?: number
  source?: SoundSource
  /** Effect Hotkey (Electron accelerator). Only meaningful on `effects` items. Personal to this machine. */
  hotkey?: string
}

/** How a Scene moves through its Music list (CONTEXT.md "Music Mode"); absent means `single`. */
export type MusicMode = 'single' | 'sequential' | 'shuffle'

const MUSIC_MODES: readonly MusicMode[] = ['single', 'sequential', 'shuffle']

/** Any stored, imported or Registry-supplied value that is not a known Music Mode reads as `single`. */
export function normalizeMusicMode(raw: unknown): MusicMode {
  return MUSIC_MODES.includes(raw as MusicMode)
    ? raw as MusicMode
    : 'single'
}

/**
 * `name`, or `name (imported)` repeated until no existing Scene has it, ignoring
 * case. Used by Scene Import and Registry install so neither shadows a Scene.
 */
export function uniqueSceneName(name: string, existing: readonly Scene[]): string {
  const taken = new Set(existing.map(s => String(s.name).toLowerCase()))
  let unique = name
  while (taken.has(unique.toLowerCase()))
    unique = `${unique} (imported)`
  return unique
}

export interface Scene {
  id: string
  name: string
  ambience: SceneItem[]
  music: SceneItem[]
  effects: SceneItem[]
  /** Music Mode; omitted when `single`. Part of the Scene: exported and installed with it. */
  musicMode?: MusicMode
  /** Scene Hotkey (Electron accelerator). Personal to this machine: never exported. */
  hotkey?: string
  createdAt: string
  updatedAt: string
}

const SCENES_FILENAME = 'scenes.json'

function getScenesPath(config: Config): string {
  const base = process.env.HIBIKI_USER_DATA
  const dbPath = config.database.path
  const dir = base
    ? join(base, 'data')
    : dirname(dbPath)
  return join(dir, SCENES_FILENAME)
}

function isSceneArray(data: unknown): data is Scene[] {
  return Array.isArray(data)
}

const log = createLogger('scenes')

/** How many items across a Scene's categories carry a repeat interval; export and import log it (#708). */
export function countRepeatIntervals(scene: Pick<Scene, SoundCategory>): number {
  return SOUND_CATEGORIES.reduce(
    (count, category) => count + scene[category].filter(item => item.repeatMin !== undefined || item.repeatMax !== undefined).length,
    0,
  )
}

export interface SceneStoreOptions {
  /** Current Action Hotkeys, so Scene and Effect Hotkeys can be checked against them. */
  getActionHotkeys?: () => Promise<ActionHotkeys>
}

/** A plain object (not null, not an array): what every untrusted Scene shape is checked against first. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectInput(message: string): never {
  log.warn(`Rejected scene save: ${message}`)
  throw new Error(message)
}

function normalizeSource(raw: unknown): SoundSource | undefined {
  if (!isRecord(raw) || typeof raw.name !== 'string')
    return undefined
  const source: SoundSource = { name: raw.name }
  if (typeof raw.url === 'string')
    source.url = raw.url
  if (typeof raw.note === 'string')
    source.note = raw.note
  return source
}

/**
 * Keeps only the known item fields with the right type; a volume is clamped
 * into 0-100. Everything else (wrong types, unknown keys) is dropped with a
 * warn. Effect Hotkeys are kept here and normalised by the caller.
 */
function normalizeItem(raw: unknown, category: SoundCategory, index: number, sceneName: string): SceneItem {
  const where = `Scene ${category} item ${index + 1}`
  if (!isRecord(raw) || !isSafeSoundId(raw.soundId))
    rejectInput(`${where} has no valid sound id`)
  const item: SceneItem = { soundId: raw.soundId }
  const dropped: string[] = []
  if (typeof raw.soundName === 'string')
    item.soundName = raw.soundName
  else if (raw.soundName !== undefined)
    dropped.push('soundName')
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume))
    item.volume = Math.min(100, Math.max(0, raw.volume))
  else if (raw.volume !== undefined)
    dropped.push('volume')
  for (const key of ['enabled', 'loop'] as const) {
    if (typeof raw[key] === 'boolean')
      item[key] = raw[key]
    else if (raw[key] !== undefined)
      dropped.push(key)
  }
  for (const key of ['repeatMin', 'repeatMax'] as const) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
      item[key] = value
    else if (value !== undefined)
      dropped.push(key)
  }
  const source = normalizeSource(raw.source)
  if (source)
    item.source = source
  else if (raw.source !== undefined)
    dropped.push('source')
  if (typeof raw.hotkey === 'string')
    item.hotkey = raw.hotkey
  else if (raw.hotkey !== undefined && raw.hotkey !== null)
    dropped.push('hotkey')
  if (item.volume !== undefined && item.volume !== raw.volume)
    log.warn(`Scene "${sceneName}": ${category} item ${raw.soundId} volume ${String(raw.volume)} clamped to ${item.volume}`)
  if (dropped.length > 0)
    log.warn(`Scene "${sceneName}": dropped invalid ${dropped.join(', ')} on ${category} item ${raw.soundId}`)
  return item
}

function normalizeItems(raw: unknown, category: SoundCategory, sceneName: string): SceneItem[] {
  if (raw === undefined)
    return []
  if (!Array.isArray(raw))
    rejectInput(`Scene ${category} must be a list`)
  const items = raw.map((item, index) => normalizeItem(item, category, index, sceneName))
  // The editor keys a category's cards and its Ambience playback by sound id,
  // so a second item with the same id would act as the first (#715).
  const seen = new Set<string>()
  for (const { soundId } of items) {
    if (seen.has(soundId))
      rejectInput(`Scene ${category} lists sound ${soundId} twice`)
    seen.add(soundId)
  }
  return items
}

function withoutHotkey(items: SceneItem[]): SceneItem[] {
  return items.map(({ hotkey: _hotkey, ...rest }) => rest)
}

function normalizeEffects(effects: SceneItem[]): SceneItem[] {
  return effects.map((item) => {
    const { hotkey: raw, ...rest } = item
    const hotkey = normalizeOptionalAccelerator(raw)
    return hotkey
      ? { ...rest, hotkey }
      : rest
  })
}

interface SceneInput {
  id?: string
  name: string
  ambience?: SceneItem[]
  music?: SceneItem[]
  effects?: SceneItem[]
  musicMode?: MusicMode
  hotkey?: string
}

/**
 * The one gate every Scene write goes through (renderer, Scene Import,
 * Registry install): it rejects what has no sensible reading and normalises
 * the rest, so `scenes.json` only ever holds the shape `Scene` declares (#652).
 */
function normalizeSceneInput(raw: unknown): { id?: string, name: string, items: Record<SoundCategory, SceneItem[]> } {
  if (!isRecord(raw))
    rejectInput('Scene must be an object')
  if (typeof raw.name !== 'string' || raw.name.trim() === '')
    rejectInput('Scene name must be a non-empty string')
  const name = raw.name
  const items = {} as Record<SoundCategory, SceneItem[]>
  for (const category of SOUND_CATEGORIES)
    items[category] = normalizeItems(raw[category], category, name)
  if (raw.id !== undefined && (typeof raw.id !== 'string' || raw.id === ''))
    log.warn(`Scene "${name}": ignoring invalid id ${JSON.stringify(raw.id)}, generating one`)
  const id = typeof raw.id === 'string' && raw.id !== ''
    ? raw.id
    : undefined
  return { id, name, items }
}

export function createSceneStore(config: Config, options: SceneStoreOptions = {}) {
  const filePath = getScenesPath(config)
  const store = createJsonFileStore<Scene[]>(filePath, { defaultValue: [], isValid: isSceneArray })

  return {
    async list(): Promise<Scene[]> {
      return store.read()
    },

    async get(id: string): Promise<Scene | null> {
      const scenes = await store.read()
      return scenes.find(s => s.id === id) ?? null
    },

    async save(scene: SceneInput): Promise<Scene> {
      const input = normalizeSceneInput(scene)
      const actionHotkeys = await options.getActionHotkeys?.()
      return store.update((scenes) => {
        const now = new Date().toISOString()
        const existing = input.id
          ? scenes.find(s => s.id === input.id)
          : null

        const saved: Scene = {
          id: existing?.id ?? input.id ?? randomUUID(),
          name: input.name,
          ambience: withoutHotkey(input.items.ambience),
          music: withoutHotkey(input.items.music),
          effects: normalizeEffects(input.items.effects),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }

        const musicMode = normalizeMusicMode(scene.musicMode)
        if (musicMode !== 'single')
          saved.musicMode = musicMode
        if (scene.musicMode !== undefined && scene.musicMode !== musicMode)
          log.warn(`Scene "${saved.name}" (${saved.id}): unknown Music Mode ${JSON.stringify(scene.musicMode)}, using single`)
        const previousMode = normalizeMusicMode(existing?.musicMode)
        if (existing && previousMode !== musicMode)
          log.info(`Scene "${saved.name}" (${saved.id}) Music Mode ${previousMode} -> ${musicMode}`)

        const hotkey = normalizeOptionalAccelerator(scene.hotkey)
        if (hotkey)
          saved.hotkey = hotkey

        try {
          assertSceneHotkeysAvailable(saved, scenes.filter(s => s.id !== saved.id), actionHotkeys)
        }
        catch (e) {
          log.info(`Rejected hotkey binding on scene "${saved.name}" (${saved.id}): ${(e as Error).message}`)
          throw e
        }
        const bound = [
          ...(saved.hotkey
            ? [`scene ${saved.hotkey}`]
            : []),
          ...saved.effects.filter(e => e.hotkey).map(e => `effect ${e.soundName ?? e.soundId} ${e.hotkey}`),
        ]
        if (bound.length > 0)
          log.info(`Hotkey bindings on scene "${saved.name}" (${saved.id}): ${bound.join(', ')}`)

        const next = existing
          ? scenes.map(s => (s.id === saved.id
              ? saved
              : s))
          : [...scenes, saved]
        log.info(`${existing ? 'Updated' : 'Created'} scene "${saved.name}" (${saved.id}): ${saved.music.length} music, ${saved.ambience.length} ambience, ${saved.effects.length} effects, Music Mode ${musicMode}`)
        return { next, result: saved }
      })
    },

    async remove(id: string): Promise<void> {
      return store.update((scenes) => {
        const filtered = scenes.filter(s => s.id !== id)
        if (filtered.length === scenes.length)
          throw new Error(`Scene '${id}' not found`)
        log.info(`Deleted scene ${id}`)
        return { next: filtered, result: undefined }
      })
    },

    /**
     * Moves a Scene to `toIndex` in the Scene list (clamped to the ends). The
     * `scenes.json` array order is the Scene order the list and Previous/Next
     * Scene follow; the Scene itself, `updatedAt` included, is left untouched.
     */
    async move(id: string, toIndex: number): Promise<void> {
      if (!Number.isInteger(toIndex)) {
        log.warn(`Rejected move of scene ${id}: position ${String(toIndex)} is not an integer`)
        throw new Error('Scene position must be an integer')
      }
      return store.update((scenes) => {
        const from = scenes.findIndex(s => s.id === id)
        if (from === -1)
          throw new Error(`Scene '${id}' not found`)
        const to = Math.min(scenes.length - 1, Math.max(0, toIndex))
        if (from === to)
          return { next: scenes, result: undefined, skipWrite: true }
        const next = [...scenes]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        log.info(`Moved scene "${moved.name}" (${id}) from position ${from + 1} to ${to + 1} of ${next.length}`)
        return { next, result: undefined }
      })
    },

    async removeSoundFromAll(category: 'ambience' | 'music' | 'effects', soundId: string): Promise<void> {
      return store.update((scenes) => {
        let changed = false
        for (const scene of scenes) {
          const before = scene[category].length
          scene[category] = scene[category].filter(item => item.soundId !== soundId)
          if (scene[category].length !== before) {
            scene.updatedAt = new Date().toISOString()
            changed = true
          }
        }
        if (changed)
          log.info(`Removed deleted ${category} sound ${soundId} from scenes`)
        return { next: scenes, result: undefined, skipWrite: !changed }
      })
    },
  }
}

export type SceneStore = ReturnType<typeof createSceneStore>
