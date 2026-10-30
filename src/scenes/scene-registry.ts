import type { Config } from '../config'
import type { RegistryEntry, RegistryIndex } from './scene-package.types'
import type { Scene, SceneItem } from './scene-store'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeJsonFileAtomic } from '../json-file'
import { createLogger } from '../logger'
import { createSceneStore, normalizeMusicMode, uniqueSceneName } from './scene-store'

const log = createLogger('scene-registry')

export const REGISTRY_INDEX_URL = 'https://raw.githubusercontent.com/PhyberApex/hibiki/main/registry/index.json'
const CACHE_FILENAME = 'registry-cache.json'
const STALE_MS = 24 * 60 * 60 * 1000 // 24 hours
/** Without it a stalled connection pins the renderer's `getIndex` for undici's multi-minute defaults (#652). */
export const DEFAULT_REGISTRY_FETCH_TIMEOUT_MS = 10_000

interface CachedIndex {
  fetchedAt: string
  /** Absent in caches written before `HIBIKI_REGISTRY_INDEX_URL`: those came from the default index. */
  url?: string
  data: RegistryIndex
}

/** The index to fetch: `HIBIKI_REGISTRY_INDEX_URL` when set, else the project's own. */
export function resolveRegistryIndexUrl(override: string | undefined): string {
  return override?.trim() || REGISTRY_INDEX_URL
}

function getCachePath(config: Config): string {
  const base = process.env.HIBIKI_USER_DATA
  const dbPath = config.database.path
  const dir = base
    ? join(base, 'data')
    : dirname(dbPath)
  return join(dir, CACHE_FILENAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Only the part every caller relies on; each entry is checked when it is installed. */
function isRegistryIndex(data: unknown): data is RegistryIndex {
  return isRecord(data) && Array.isArray(data.scenes)
}

function isInstallableEntry(entry: RegistryEntry): boolean {
  const scene: unknown = entry.scene
  return typeof entry.name === 'string'
    && entry.name.trim() !== ''
    && isRecord(scene)
    && (['music', 'ambience', 'effects'] as const).every(category =>
      Array.isArray(scene[category]) && scene[category].every(isRecord))
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
  await writeJsonFileAtomic(cachePath, data)
}

function registryEntryToScene(entry: RegistryEntry): Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: entry.name,
    musicMode: normalizeMusicMode(entry.scene.musicMode),
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

export interface SceneRegistryOptions {
  timeoutMs?: number
}

export function createSceneRegistry(config: Config, indexUrl = REGISTRY_INDEX_URL, { timeoutMs = DEFAULT_REGISTRY_FETCH_TIMEOUT_MS }: SceneRegistryOptions = {}) {
  const cachePath = getCachePath(config)

  /** A cached index, unless it was fetched from another index URL. */
  async function readOwnCache(): Promise<CachedIndex | null> {
    const cached = await readCache(cachePath)
    if (!cached)
      return null
    const cachedUrl = cached.url ?? REGISTRY_INDEX_URL
    if (cachedUrl !== indexUrl) {
      log.info(`Ignoring registry cache fetched from ${cachedUrl}; the index is now ${indexUrl}`)
      return null
    }
    if (isRegistryIndex(cached.data))
      return cached
    log.warn(`Ignoring malformed registry cache at ${cachePath}`)
    return null
  }

  async function request(): Promise<Response> {
    try {
      return await fetch(indexUrl, {
        signal: AbortSignal.timeout(timeoutMs),
      })
    }
    catch (e) {
      if ((e as Error).name !== 'TimeoutError')
        throw e
      log.warn(`Registry index request to ${indexUrl} timed out after ${timeoutMs} ms`)
      throw new Error(`Registry index request timed out after ${timeoutMs} ms (${indexUrl})`)
    }
  }

  return {
    async fetchIndex(forceRefresh = false): Promise<RegistryIndex> {
      if (!forceRefresh) {
        const cached = await readOwnCache()
        if (cached) {
          const age = Date.now() - new Date(cached.fetchedAt).getTime()
          if (age < STALE_MS)
            return cached.data
        }
      }

      log.info(`Fetching registry index from ${indexUrl}…`)
      const response = await request()
      if (!response.ok)
        throw new Error(`Failed to fetch registry index: ${response.status} ${response.statusText} (${indexUrl})`)

      const data: unknown = await response.json()
      if (!isRegistryIndex(data)) {
        log.warn(`Registry index from ${indexUrl} is malformed: no scenes list; not caching it`)
        throw new Error(`Registry index is malformed (${indexUrl})`)
      }
      await writeCache(cachePath, {
        fetchedAt: new Date().toISOString(),
        url: indexUrl,
        data,
      })
      log.info(`Registry index cached (${data.scenes.length} scenes)`)
      return data
    },

    async getIndex(): Promise<RegistryIndex> {
      const cached = await readOwnCache()
      if (cached)
        return cached.data
      return this.fetchIndex()
    },

    async installFromRegistry(slug: string): Promise<Scene> {
      const index = await this.getIndex()
      const entry = index.scenes.find(s => s?.slug === slug)
      if (!entry)
        throw new Error(`Scene '${slug}' not found in registry`)
      if (!isInstallableEntry(entry)) {
        log.warn(`Registry entry '${slug}' is malformed: needs a name and music, ambience and effects lists`)
        throw new Error(`Registry entry '${slug}' is malformed`)
      }

      const scenes = createSceneStore(config)
      const sceneData = registryEntryToScene(entry)
      sceneData.name = uniqueSceneName(sceneData.name, await scenes.list())

      const saved = await scenes.save(sceneData)
      log.info(`Installed "${saved.name}" from registry (${saved.id})`)
      return saved
    },
  }
}

export type SceneRegistry = ReturnType<typeof createSceneRegistry>
