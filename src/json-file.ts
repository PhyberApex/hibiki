import type { FileHandle } from 'node:fs/promises'
import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from './logger'

const log = createLogger('json-file')

export interface StorageWarning {
  file: string
  backupPath: string
}

const warnings: StorageWarning[] = []

/** Shared across every store so no two read-modify-write cycles on the same file can interleave. */
const queues = new Map<string, Promise<unknown>>()

export function getStorageWarnings(): StorageWarning[] {
  return [...warnings]
}

export function clearStorageWarnings(): void {
  warnings.length = 0
}

export interface JsonFileOptions<T> {
  defaultValue: T
  isValid: (data: unknown) => boolean
}

export function isPlainObject(data: unknown): boolean {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}

export interface JsonFileUpdateResult<T, R> {
  next: T
  result: R
  /** Skip the write when the mutator determined nothing actually changed. */
  skipWrite?: boolean
}

export interface JsonFileStore<T> {
  read: () => Promise<T>
  update: <R = void>(mutator: (data: T) => JsonFileUpdateResult<T, R>) => Promise<R>
}

function enqueue<R>(filePath: string, task: () => Promise<R>): Promise<R> {
  const prior = queues.get(filePath) ?? Promise.resolve()
  const settled = prior.then(task, task)
  queues.set(filePath, settled.then(() => undefined, () => undefined))
  return settled
}

async function backupCorruptFile(filePath: string, reason: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${filePath}.corrupt-${timestamp}.bak`
  await copyFile(filePath, backupPath)
  warnings.push({ file: filePath, backupPath })
  log.warn(`Corrupt store ${filePath} (${reason}) backed up to ${backupPath}; resetting it to the default`)
}

async function readJsonFile<T>(filePath: string, options: JsonFileOptions<T>): Promise<T> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return options.defaultValue
    throw err
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  }
  catch {
    await backupCorruptFile(filePath, raw.trim() === ''
      ? 'empty, likely an interrupted write'
      : 'unparseable JSON')
    await writeJsonFileAtomic(filePath, options.defaultValue)
    return options.defaultValue
  }

  if (!options.isValid(data)) {
    await backupCorruptFile(filePath, 'unexpected shape')
    await writeJsonFileAtomic(filePath, options.defaultValue)
    return options.defaultValue
  }

  return data as T
}

/** Windows cannot open or fsync a directory; the rename is already durable there. */
const UNSUPPORTED_DIR_SYNC_CODES = new Set(['EISDIR', 'EPERM', 'EINVAL'])

/** Best-effort: makes the rename itself durable. Never throws, the data is already in place. */
async function syncDirectory(dir: string): Promise<void> {
  let handle: FileHandle | undefined
  try {
    handle = await open(dir, 'r')
    await handle.sync()
  }
  catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code && UNSUPPORTED_DIR_SYNC_CODES.has(code))
      log.debug(`Directory fsync unsupported for ${dir} (${code})`)
    else
      log.warn(`Could not fsync directory ${dir}`, err)
  }
  finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * Writes `<file>.tmp`, fsyncs it, renames it over the live file and fsyncs
 * the directory, so neither a crash mid-write nor a power loss right after
 * the rename leaves a half-written or zero-length file.
 */
export async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp`
  const handle = await open(tmpPath, 'w')
  try {
    await handle.writeFile(JSON.stringify(data, null, 2), 'utf-8')
    await handle.sync()
  }
  finally {
    await handle.close()
  }
  await rename(tmpPath, filePath)
  await syncDirectory(dir)
}

export function createJsonFileStore<T>(filePath: string, options: JsonFileOptions<T>): JsonFileStore<T> {
  return {
    read: () => enqueue(filePath, () => readJsonFile(filePath, options)),

    update: <R = void>(mutator: (data: T) => JsonFileUpdateResult<T, R>) =>
      enqueue(filePath, async () => {
        const data = await readJsonFile(filePath, options)
        const { next, result, skipWrite } = mutator(data)
        if (!skipWrite)
          await writeJsonFileAtomic(filePath, next)
        return result
      }),
  }
}
