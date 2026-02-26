import type { Config } from '../config'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SceneItem {
  soundId: string
  soundName?: string
  volume?: number
  enabled?: boolean
  loop?: boolean
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

async function readScenes(filePath: string): Promise<Scene[]> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const data = JSON.parse(raw) as Scene[]
    return Array.isArray(data) ? data : []
  }
  catch {
    return []
  }
}

async function writeScenes(filePath: string, scenes: Scene[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(scenes, null, 2), 'utf-8')
}

export function createSceneStore(config: Config) {
  const filePath = getScenesPath(config)

  return {
    async list(): Promise<Scene[]> {
      return readScenes(filePath)
    },

    async get(id: string): Promise<Scene | null> {
      const scenes = await readScenes(filePath)
      return scenes.find(s => s.id === id) ?? null
    },

    async save(scene: {
      id?: string
      name: string
      ambience?: SceneItem[]
      music?: SceneItem[]
      effects?: SceneItem[]
    }): Promise<Scene> {
      const scenes = await readScenes(filePath)
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

      const updated = existing
        ? scenes.map(s => (s.id === saved.id ? saved : s))
        : [...scenes, saved]
      await writeScenes(filePath, updated)
      return saved
    },

    async remove(id: string): Promise<void> {
      const scenes = await readScenes(filePath)
      const filtered = scenes.filter(s => s.id !== id)
      if (filtered.length === scenes.length)
        throw new Error(`Scene '${id}' not found`)
      await writeScenes(filePath, filtered)
    },

    async removeSoundFromAll(category: 'ambience' | 'music' | 'effects', soundId: string): Promise<void> {
      const scenes = await readScenes(filePath)
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
        await writeScenes(filePath, scenes)
    },
  }
}

export type SceneStore = ReturnType<typeof createSceneStore>
