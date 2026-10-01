import type { Config } from '../config'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { createJsonFileStore } from '../json-file'

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
}

export interface Scene {
  id: string
  name: string
  ambience: SceneItem[]
  music: SceneItem[]
  effects: SceneItem[]
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

export function createSceneStore(config: Config) {
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
    }): Promise<Scene> {
      return store.update((scenes) => {
        const now = new Date().toISOString()
        const existing = scene.id ? scenes.find(s => s.id === scene.id) : null

        const saved: Scene = {
          id: existing?.id ?? scene.id ?? randomUUID(),
          name: scene.name,
          ambience: scene.ambience ?? [],
          music: scene.music ?? [],
          effects: scene.effects ?? [],
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }

        const next = existing
          ? scenes.map(s => (s.id === saved.id ? saved : s))
          : [...scenes, saved]
        return { next, result: saved }
      })
    },

    async remove(id: string): Promise<void> {
      return store.update((scenes) => {
        const filtered = scenes.filter(s => s.id !== id)
        if (filtered.length === scenes.length)
          throw new Error(`Scene '${id}' not found`)
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
        return { next: scenes, result: undefined, skipWrite: !changed }
      })
    },
  }
}

export type SceneStore = ReturnType<typeof createSceneStore>
