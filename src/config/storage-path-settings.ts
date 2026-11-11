import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { createLogger } from '../logger'

const log = createLogger('config')

const STORAGE_PATH_KEY = 'storage.path'

export interface StoragePathStore {
  get: (key: string) => Promise<string | null | undefined>
  set: (key: string, value: string) => Promise<void>
}

/**
 * Why `path` cannot hold the sound folders, or null when it can: an absolute,
 * existing directory Hibiki may write to. Main applies the stored path to
 * `HIBIKI_STORAGE_PATH` on the next boot, so it is checked before it is stored (#776).
 */
async function storagePathProblem(path: string): Promise<string | null> {
  if (!isAbsolute(path))
    return 'it must be an absolute path'
  let info
  try {
    info = await stat(path)
  }
  catch {
    return 'the folder does not exist'
  }
  if (!info.isDirectory())
    return 'it is not a folder'
  try {
    await access(path, constants.W_OK)
  }
  catch {
    return 'Hibiki cannot write to it'
  }
  return null
}

/** The custom root for the music, effects and ambience folders; unset means the default under `userData`. */
export function createStoragePathSettings(store: StoragePathStore) {
  async function get(): Promise<{ path: string | null }> {
    const stored = await store.get(STORAGE_PATH_KEY)
    return { path: stored?.trim() || null }
  }

  /** An empty or whitespace-only path clears the setting; anything else must pass `storagePathProblem`. */
  async function set(path: string): Promise<void> {
    if (typeof path !== 'string')
      throw new TypeError('Storage path must be a string')
    const value = path.trim()
    if (value) {
      const problem = await storagePathProblem(value)
      if (problem) {
        log.warn(`Rejected storage path ${value}: ${problem}`)
        throw new Error(`Can't use ${value} as the storage folder: ${problem}.`)
      }
    }
    await store.set(STORAGE_PATH_KEY, value)
    log.info(value
      ? `Storage path set to ${value} (applies on next launch)`
      : 'Storage path cleared (default applies on next launch)')
  }

  return { get, set }
}
