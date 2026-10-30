import type { Config } from '../config'
import type { SoundCategory } from './sound.types'
import { dirname, join, resolve } from 'node:path'
import { createJsonFileStore, isPlainObject } from '../json-file'

const DURATIONS_FILENAME = 'sound-durations.json'

/** Milliseconds, or null for a file whose header could not be read (so it is not re-parsed on every list). */
type DurationsByKey = Record<string, number | null>

function getDurationsFilePath(config: Config): string {
  const dir = resolve(process.cwd(), dirname(config.database.path))
  return join(dir, DURATIONS_FILENAME)
}

function durationKey(category: SoundCategory, id: string): string {
  return `${category}/${id}`
}

function isStoredDuration(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0)
}

/** Sidecar next to `sound-tags.json` holding each measured sound's duration (#695). */
export function createSoundDurationsStore(config: Config) {
  const filePath = getDurationsFilePath(config)
  const store = createJsonFileStore<DurationsByKey>(filePath, { defaultValue: {}, isValid: isPlainObject })

  return {
    /** Every measured sound of `category`, keyed by id; a missing id has never been measured. */
    async getAll(category: SoundCategory): Promise<Map<string, number | null>> {
      const data = await store.read()
      const prefix = `${category}/`
      const result = new Map<string, number | null>()
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith(prefix) && isStoredDuration(value))
          result.set(key.slice(prefix.length), value)
      }
      return result
    },

    async setMany(category: SoundCategory, durations: Map<string, number | null>): Promise<void> {
      if (durations.size === 0)
        return
      await store.update((data) => {
        const next = { ...data }
        for (const [id, durationMs] of durations)
          next[durationKey(category, id)] = durationMs
        return { next, result: undefined }
      })
    },

    async remove(category: SoundCategory, id: string): Promise<void> {
      return store.update((data) => {
        const key = durationKey(category, id)
        if (!(key in data))
          return { next: data, result: undefined, skipWrite: true }
        const next = { ...data }
        delete next[key]
        return { next, result: undefined }
      })
    },
  }
}

export type SoundDurationsStore = ReturnType<typeof createSoundDurationsStore>
