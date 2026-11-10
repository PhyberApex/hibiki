import type { FileHandle } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
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

export function escapeRegExp(text: string): string {
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

function backupPathFor(filePath: string, attempt: number): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${filePath}.corrupt-${timestamp}${attempt === 0
    ? ''
    : `-${randomBytes(3).toString('hex')}`}.bak`
}

async function backupCorruptFile<T>(filePath: string, raw: string, reason: string, options: JsonFileOptions<T>): Promise<void> {
  const contents = options.redactBackup
    ? options.redactBackup(raw)
    : raw
  let backupPath = backupPathFor(filePath, 0)
  // Written fresh rather than copied: `copyFile` would carry over the source's (possibly 0644) mode.
  // `wx` never writes through a file or symlink already at that name; a same-millisecond clash retries once.
  try {
    await writeFile(backupPath, contents, { encoding: 'utf-8', mode: FILE_MODE, flag: 'wx' })
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST')
      throw err
    backupPath = backupPathFor(filePath, 1)
    await writeFile(backupPath, contents, { encoding: 'utf-8', mode: FILE_MODE, flag: 'wx' })
  }
  warnings.push({ file: filePath, backupPath })
  log.warn(`Corrupt store ${filePath} (${reason}) backed up to ${backupPath}${options.redactBackup ? ' with secrets redacted' : ''}; resetting it to the default`)
}

async function restrictMode(path: string, wanted: number): Promise<void> {
  if (!HAS_POSIX_MODES)
    return
  const stats = await lstat(path)
  // `chmod` follows symlinks; a store path that is a symlink is left alone rather than retargeted.
  if (stats.isSymbolicLink()) {
    log.warn(`Not restricting ${path}: it is a symlink`)
    return
  }
  const mode = stats.mode & 0o777
  if (mode !== wanted) {
    await chmod(path, wanted)
    log.info(`Restricted ${path} from ${mode.toString(8)} to ${wanted.toString(8)} (owner-only)`)
  }
}

/** Backups written before #769 hold secrets in the clear; they are never cleaned up, so they are redacted in place. */
async function redactOldBackup(path: string, redact: (raw: string) => string): Promise<void> {
  if ((await lstat(path)).isSymbolicLink())
    return
  const raw = await readFile(path, 'utf-8')
  const redacted = redact(raw)
  if (redacted !== raw) {
    await writeFileAtomic(path, redacted)
    log.info(`Redacted secrets in old backup ${path}`)
  }
}

/**
 * Once per store per launch: tightens the store's directory, the store and
 * its old corrupt backups written world-readable by earlier versions,
 * redacts those backups, and deletes temp files a crashed write left behind
 * (they hold a full copy of the store). Never throws, a store that cannot be
 * repaired is still usable.
 */
async function repairStoreFiles<T>(filePath: string, options: JsonFileOptions<T>): Promise<void> {
  const dir = dirname(filePath)
  const base = basename(filePath)
  let entries: string[]
  try {
    entries = await readdir(dir)
    await restrictMode(dir, DIR_MODE)
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      log.warn(`Could not repair ${dir} for ${base}`, err)
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
        continue
      }
      if (entry !== base && !backup.test(entry))
        continue
      if (entry !== base && options.redactBackup)
        await redactOldBackup(path, options.redactBackup)
      await restrictMode(path, FILE_MODE)
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
      : 'unparseable JSON', options)
    await writeJsonFileAtomic(filePath, options.defaultValue)
    return options.defaultValue
  }

  if (!options.isValid(data)) {
    await backupCorruptFile(filePath, raw, 'unexpected shape', options)
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
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2))
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
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
    // Left behind, it would hold a full copy of the store until the next launch's repair.
    await unlink(tmpPath).catch((unlinkErr: unknown) => log.warn(`Could not remove temp file ${tmpPath} after a failed write`, unlinkErr))
    throw err
  }
  await syncDirectory(dir)
}

export function createJsonFileStore<T>(filePath: string, options: JsonFileOptions<T>): JsonFileStore<T> {
  let repaired: Promise<void> | undefined
  const repairOnce = () => (repaired ??= repairStoreFiles(filePath, options))

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
