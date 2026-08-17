import type { Config } from '../config'
import type { SoundCategory } from './sound.types'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const TAGS_FILENAME = 'sound-tags.json'

type TagsByKey = Record<string, string[]>

function getTagsFilePath(config: Config): string {
  const dir = resolve(process.cwd(), dirname(config.database.path))
  return join(dir, TAGS_FILENAME)
}

function tagKey(category: SoundCategory, id: string): string {
  return `${category}/${id}`
}

async function readData(filePath: string): Promise<TagsByKey> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const data = JSON.parse(raw) as TagsByKey
    return typeof data === 'object' && data !== null ? data : {}
  }
  catch {
    return {}
  }
}

async function writeData(filePath: string, data: TagsByKey): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export function normalizeTags(tags: string[]): string[] {
  return tags.map(t => t.trim()).filter(t => t.length > 0)
}

export function createSoundTagsStore(config: Config) {
  const filePath = getTagsFilePath(config)

  return {
    async getAll(category: SoundCategory): Promise<Map<string, string[]>> {
      const data = await readData(filePath)
      const prefix = `${category}/`
      const result = new Map<string, string[]>()
      for (const [key, tags] of Object.entries(data)) {
        if (key.startsWith(prefix) && Array.isArray(tags))
          result.set(key.slice(prefix.length), tags)
      }
      return result
    },

    async get(category: SoundCategory, id: string): Promise<string[]> {
      const data = await readData(filePath)
      const tags = data[tagKey(category, id)]
      return Array.isArray(tags) ? tags : []
    },

    async set(category: SoundCategory, id: string, tags: string[]): Promise<string[]> {
      const normalized = normalizeTags(tags)
      const data = await readData(filePath)
      const key = tagKey(category, id)
      if (normalized.length === 0)
        delete data[key]
      else
        data[key] = normalized
      await writeData(filePath, data)
      return normalized
    },

    async remove(category: SoundCategory, id: string): Promise<void> {
      const data = await readData(filePath)
      const key = tagKey(category, id)
      if (key in data) {
        delete data[key]
        await writeData(filePath, data)
      }
    },
  }
}

export type SoundTagsStore = ReturnType<typeof createSoundTagsStore>
