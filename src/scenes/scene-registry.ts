import type { Config } from '../config'
import type { RegistryIndex } from './scene-package.types'
import type { Scene } from './scene-store'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createLogger } from '../logger'
import { importScene } from './scene-import'

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

    async downloadAndInstall(downloadUrl: string): Promise<Scene> {
      log.info(`Downloading scene from ${downloadUrl}`)
      const response = await fetch(downloadUrl)
      if (!response.ok)
        throw new Error(`Download failed: ${response.status} ${response.statusText}`)
      if (!response.body)
        throw new Error('Download failed: empty response body')

      const tmpPath = join(tmpdir(), `hibiki-download-${randomUUID()}.zip`)
      const fileStream = createWriteStream(tmpPath)
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), fileStream)

      const scene = await importScene(config, tmpPath)
      log.info(`Installed "${scene.name}" from registry`)
      return scene
    },

    async installFromUrl(url: string): Promise<Scene> {
      return this.downloadAndInstall(url)
    },

    async installFromRegistry(slug: string): Promise<Scene> {
      const index = await this.getIndex()
      const entry = index.scenes.find(s => s.slug === slug)
      if (!entry)
        throw new Error(`Scene '${slug}' not found in registry`)
      return this.downloadAndInstall(entry.downloadUrl)
    },
  }
}

export type SceneRegistry = ReturnType<typeof createSceneRegistry>
