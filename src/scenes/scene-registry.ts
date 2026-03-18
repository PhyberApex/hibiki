import type { Config } from '../config'
import type { RegistryEntry, RegistryIndex } from './scene-package.types'
import type { Scene, SceneItem } from './scene-store'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createLogger } from '../logger'
import { createSceneStore } from './scene-store'

const log = createLogger('scene-registry')

const REGISTRY_INDEX_URL = 'https://raw.githubusercontent.com/PhyberApex/hibiki/main/registry/index.json'
const CACHE_FILENAME = 'registry-cache.json'
const STALE_MS = 24 * 60 * 60 * 1000 // 24 hours

interface CachedIndex {
  fetchedAt: string
  data: RegistryIndex
}

function getCachePath(config: Config): string {
  const base = process.env.HIBIKI_USER_DATA
  const dbPath = config.database.path
  const dir = base ? join(base, 'data') : dirname(dbPath)
  return join(dir, CACHE_FILENAME)
}

async function readCache(cachePath: string): Promise<CachedIndex | null> {
  try {
    const raw = await readFile(cachePath, 'utf-8')
    return JSON.parse(raw) as CachedIndex
  }
  catch {
    return null
  }
}

async function writeCache(cachePath: string, data: CachedIndex): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8')
}

function registryEntryToScene(entry: RegistryEntry): Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: entry.name,
    music: entry.scene.music.map(t => ({
      soundId: t.soundName,
      soundName: t.soundName,
      volume: t.volume,
      loop: t.loop,
      source: t.source,
    } satisfies SceneItem)),
    ambience: entry.scene.ambience.map(t => ({
      soundId: t.soundName,
      soundName: t.soundName,
      volume: t.volume,
      enabled: t.enabled,
      source: t.source,
    } satisfies SceneItem)),
    effects: entry.scene.effects.map(t => ({
      soundId: t.soundName,
      soundName: t.soundName,
      volume: t.volume,
      source: t.source,
    } satisfies SceneItem)),
  }
}

export function createSceneRegistry(config: Config) {
  const cachePath = getCachePath(config)

  return {
    async fetchIndex(forceRefresh = false): Promise<RegistryIndex> {
      if (!forceRefresh) {
        const cached = await readCache(cachePath)
        if (cached) {
          const age = Date.now() - new Date(cached.fetchedAt).getTime()
          if (age < STALE_MS)
            return cached.data
        }
      }

      log.info('Fetching registry index…')
      const response = await fetch(REGISTRY_INDEX_URL)
      if (!response.ok)
        throw new Error(`Failed to fetch registry index: ${response.status} ${response.statusText}`)

      const data = await response.json() as RegistryIndex
      await writeCache(cachePath, { fetchedAt: new Date().toISOString(), data })
      log.info(`Registry index cached (${data.scenes.length} scenes)`)
      return data
    },

    async getIndex(): Promise<RegistryIndex> {
      const cached = await readCache(cachePath)
      if (cached)
        return cached.data
      return this.fetchIndex()
    },

    async installFromRegistry(slug: string): Promise<Scene> {
      const index = await this.getIndex()
      const entry = index.scenes.find(s => s.slug === slug)
      if (!entry)
        throw new Error(`Scene '${slug}' not found in registry`)

      const scenes = createSceneStore(config)
      const existing = await scenes.list()
      const existingNames = new Set(existing.map(s => s.name.toLowerCase()))

      const sceneData = registryEntryToScene(entry)
      while (existingNames.has(sceneData.name.toLowerCase())) {
        sceneData.name = `${sceneData.name} (imported)`
      }

      const saved = await scenes.save(sceneData)
      log.info(`Installed "${saved.name}" from registry (${saved.id})`)
      return saved
    },
  }
}

export type SceneRegistry = ReturnType<typeof createSceneRegistry>
