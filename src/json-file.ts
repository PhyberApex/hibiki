import type { FileHandle } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createLogger } from './logger'

const log = createLogger('json-file')

/**
 * Stores can hold secrets in the clear (keyring-less Linux, #769), so every
 * file this module creates is owner-only, and so is a directory it creates.
 */
const FILE_MODE = 0o600
const DIR_MODE = 0o700

/** Windows has no POSIX permission bits to repair: `stat` always reports 0o666 there. */
const HAS_POSIX_MODES = process.platform !== 'win32'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
  /** Rewrites the raw contents of a corrupt file before it is kept as a backup, e.g. to strip secrets. */
  redactBackup?: (raw: string) => string
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

async function backupCorruptFile(filePath: string, raw: string, reason: string, redact?: (raw: string) => string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${filePath}.corrupt-${timestamp}.bak`
  // Written fresh rather than copied: `copyFile` would carry over the source's (possibly 0644) mode.
  await writeFile(backupPath, redact
    ? redact(raw)
    : raw, { encoding: 'utf-8', mode: FILE_MODE, flag: 'wx' })
  warnings.push({ file: filePath, backupPath })
  log.warn(`Corrupt store ${filePath} (${reason}) backed up to ${backupPath}${redact ? ' with secrets redacted' : ''}; resetting it to the default`)
}

/**
 * Once per store per launch: tightens a store and its old corrupt backups
 * written 0644 by earlier versions, and deletes temp files a crashed write
 * left behind (they hold a full copy of the store). Never throws, a store
 * that cannot be repaired is still usable.
 */
async function repairStoreFiles(filePath: string): Promise<void> {
  const dir = dirname(filePath)
  const base = basename(filePath)
  let entries: string[]
  try {
    entries = await readdir(dir)
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      log.warn(`Could not list ${dir} to repair ${base}`, err)
    return
  }

  const staleTemp = new RegExp(`^${escapeRegExp(base)}\\.(?:[0-9a-f]+\\.)?tmp$`)
  const backup = new RegExp(`^${escapeRegExp(base)}\\.corrupt-.*\\.bak$`)
  for (const entry of entries) {
    const path = join(dir, entry)
    try {
      if (staleTemp.test(entry)) {
        await unlink(path)
        log.info(`Removed leftover temp file ${path} from an interrupted write`)
      }
      else if (HAS_POSIX_MODES && (entry === base || backup.test(entry))) {
        const mode = (await stat(path)).mode & 0o777
        if (mode !== FILE_MODE) {
          await chmod(path, FILE_MODE)
          log.info(`Restricted ${path} from ${mode.toString(8)} to ${FILE_MODE.toString(8)} (owner-only)`)
        }
      }
    }
    catch (err) {
      log.warn(`Could not repair ${path}`, err)
    }
  }
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
    await backupCorruptFile(filePath, raw, raw.trim() === ''
      ? 'empty, likely an interrupted write'
      : 'unparseable JSON', options.redactBackup)
    await writeJsonFileAtomic(filePath, options.defaultValue)
    return options.defaultValue
  }

  if (!options.isValid(data)) {
    await backupCorruptFile(filePath, raw, 'unexpected shape', options.redactBackup)
    await writeJsonFileAtomic(filePath, options.defaultValue)
    return options.defaultValue
  }

  return data as T
}

/** Windows (and some filesystems) refuse to fsync a directory; the rename is already durable there. */
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
 * Writes a fresh `<file>.<random>.tmp`, fsyncs it, renames it over the live
 * file and fsyncs the directory, so neither a crash mid-write nor a power
 * loss right after the rename leaves a half-written or zero-length file.
 * The temp file is created exclusively (`wx`) and owner-only, so a file or
 * symlink already sitting at that path fails the write instead of being
 * followed, and the live file inherits 0600 through the rename.
 */
export async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  const contents = JSON.stringify(data, null, 2)
  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  const handle = await open(tmpPath, 'wx', FILE_MODE)
  try {
    try {
      await handle.writeFile(contents, 'utf-8')
      await handle.sync()
    }
    finally {
      await handle.close()
    }
    await rename(tmpPath, filePath)
  }
  catch (err) {
    await unlink(tmpPath).catch(() => undefined)
    throw err
  }
  await syncDirectory(dir)
}

export function createJsonFileStore<T>(filePath: string, options: JsonFileOptions<T>): JsonFileStore<T> {
  let repaired: Promise<void> | undefined
  const repairOnce = () => (repaired ??= repairStoreFiles(filePath))

  return {
    read: () => enqueue(filePath, async () => {
      await repairOnce()
      return readJsonFile(filePath, options)
    }),

    update: <R = void>(mutator: (data: T) => JsonFileUpdateResult<T, R>) =>
      enqueue(filePath, async () => {
        await repairOnce()
        const data = await readJsonFile(filePath, options)
        const { next, result, skipWrite } = mutator(data)
        if (!skipWrite)
          await writeJsonFileAtomic(filePath, next)
        return result
      }),
  }
}
