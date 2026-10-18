import type { Config } from '../config'
import type { ActionHotkeys } from './hotkeys'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { createJsonFileStore } from '../json-file'
import { createLogger } from '../logger'
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
  source?: SoundSource
  /** Effect Hotkey (Electron accelerator). Only meaningful on `effects` items. Personal to this machine. */
  hotkey?: string
}

/** How a Scene moves through its Music list (CONTEXT.md "Music Mode"); absent means `single`. */
export type MusicMode = 'single' | 'sequential' | 'shuffle'

export const MUSIC_MODES: readonly MusicMode[] = ['single', 'sequential', 'shuffle']

/** Any stored, imported or Registry-supplied value that is not a known Music Mode reads as `single`. */
export function normalizeMusicMode(raw: unknown): MusicMode {
  return MUSIC_MODES.includes(raw as MusicMode) ? raw as MusicMode : 'single'
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
  const dir = base ? join(base, 'data') : dirname(dbPath)
  return join(dir, SCENES_FILENAME)
}

function isSceneArray(data: unknown): data is Scene[] {
  return Array.isArray(data)
}

const log = createLogger('scenes')

export interface SceneStoreOptions {
  /** Current Action Hotkeys, so Scene and Effect Hotkeys can be checked against them. */
  getActionHotkeys?: () => Promise<ActionHotkeys>
}

function withoutHotkey(items: SceneItem[]): SceneItem[] {
  return items.map(({ hotkey: _hotkey, ...rest }) => rest)
}

function normalizeEffects(effects: SceneItem[]): SceneItem[] {
  return effects.map((item) => {
    const { hotkey: raw, ...rest } = item
    const hotkey = normalizeOptionalAccelerator(raw)
    return hotkey ? { ...rest, hotkey } : rest
  })
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

    async save(scene: {
      id?: string
      name: string
      ambience?: SceneItem[]
      music?: SceneItem[]
      effects?: SceneItem[]
      musicMode?: MusicMode
      hotkey?: string
    }): Promise<Scene> {
      const actionHotkeys = await options.getActionHotkeys?.()
      return store.update((scenes) => {
        const now = new Date().toISOString()
        const existing = scene.id ? scenes.find(s => s.id === scene.id) : null

        const saved: Scene = {
          id: existing?.id ?? scene.id ?? randomUUID(),
          name: scene.name,
          ambience: withoutHotkey(scene.ambience ?? []),
          music: withoutHotkey(scene.music ?? []),
          effects: normalizeEffects(scene.effects ?? []),
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
          ...(saved.hotkey ? [`scene ${saved.hotkey}`] : []),
          ...saved.effects.filter(e => e.hotkey).map(e => `effect ${e.soundName ?? e.soundId} ${e.hotkey}`),
        ]
        if (bound.length > 0)
          log.info(`Hotkey bindings on scene "${saved.name}" (${saved.id}): ${bound.join(', ')}`)

        const next = existing
          ? scenes.map(s => (s.id === saved.id ? saved : s))
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
