import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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

async function backupCorruptFile(filePath: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${filePath}.corrupt-${timestamp}.bak`
  await copyFile(filePath, backupPath)
  warnings.push({ file: filePath, backupPath })
  log.warn(`Corrupt store backed up to ${backupPath}`)
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
    await backupCorruptFile(filePath)
    return options.defaultValue
  }

  if (!options.isValid(data)) {
    await backupCorruptFile(filePath)
    return options.defaultValue
  }

  return data as T
}

/** Writes `<file>.tmp` then renames over the live file, so a crash mid-write never leaves a half-written file. */
export async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await rename(tmpPath, filePath)
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
