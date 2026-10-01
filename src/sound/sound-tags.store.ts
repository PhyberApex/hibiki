import type { Config } from '../config'
import type { SoundCategory } from './sound.types'
import { dirname, join, resolve } from 'node:path'
import { createJsonFileStore, isPlainObject } from '../json-file'

const TAGS_FILENAME = 'sound-tags.json'

type TagsByKey = Record<string, string[]>

function getTagsFilePath(config: Config): string {
  const dir = resolve(process.cwd(), dirname(config.database.path))
  return join(dir, TAGS_FILENAME)
}

function tagKey(category: SoundCategory, id: string): string {
  return `${category}/${id}`
}

export function normalizeTags(tags: string[]): string[] {
  return tags.map(t => t.trim()).filter(t => t.length > 0)
}

export function createSoundTagsStore(config: Config) {
  const filePath = getTagsFilePath(config)
  const store = createJsonFileStore<TagsByKey>(filePath, { defaultValue: {}, isValid: isPlainObject })

  return {
    async getAll(category: SoundCategory): Promise<Map<string, string[]>> {
      const data = await store.read()
      const prefix = `${category}/`
      const result = new Map<string, string[]>()
      for (const [key, tags] of Object.entries(data)) {
        if (key.startsWith(prefix) && Array.isArray(tags))
          result.set(key.slice(prefix.length), tags)
      }
      return result
    },

    async get(category: SoundCategory, id: string): Promise<string[]> {
      const data = await store.read()
      const tags = data[tagKey(category, id)]
      return Array.isArray(tags) ? tags : []
    },

    async set(category: SoundCategory, id: string, tags: string[]): Promise<string[]> {
      const normalized = normalizeTags(tags)
      await store.update((data) => {
        const next = { ...data }
        const key = tagKey(category, id)
        if (normalized.length === 0)
          delete next[key]
        else
          next[key] = normalized
        return { next, result: undefined }
      })
      return normalized
    },

    async remove(category: SoundCategory, id: string): Promise<void> {
      return store.update((data) => {
        const key = tagKey(category, id)
        if (!(key in data))
          return { next: data, result: undefined, skipWrite: true }
        const next = { ...data }
        delete next[key]
        return { next, result: undefined }
      })
    },
  }
}

export type SoundTagsStore = ReturnType<typeof createSoundTagsStore>
