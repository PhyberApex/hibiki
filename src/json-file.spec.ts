import type { FileHandle } from 'node:fs/promises'
import { mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { open, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearStorageWarnings, createJsonFileStore, getStorageWarnings, writeJsonFileAtomic } from './json-file'

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises')
  return {
    ...actual,
    open: jest.fn(actual.open),
  }
})

const openMock = open as jest.MockedFunction<typeof open>
/** POSIX permission bits; Windows has none to check. */
const posixIt = process.platform === 'win32'
  ? it.skip
  : it
const modeOf = (path: string) => statSync(path).mode & 0o777
const { open: realOpen } = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')

describe('createJsonFileStore', () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-json-file-'))
    clearStorageWarnings()
  })

  function isStringArray(data: unknown): data is string[] {
    return Array.isArray(data)
  }

  function isRecord(data: unknown): data is Record<string, string> {
    return typeof data === 'object' && data !== null && !Array.isArray(data)
  }

  it('read returns the default value when the file is missing, with no warning', async () => {
    const filePath = join(tempRoot, 'missing.json')
    const store = createJsonFileStore<string[]>(filePath, { defaultValue: [], isValid: isStringArray })

    const data = await store.read()

    expect(data).toEqual([])
    expect(getStorageWarnings()).toEqual([])
  })

  it('update writes atomically via a temp file and rename, never to the live file directly', async () => {
    const filePath = join(tempRoot, 'data.json')
    const store = createJsonFileStore<string[]>(filePath, { defaultValue: [], isValid: isStringArray })

    await store.update(data => ({
      next: [...data, 'a'],
      result: undefined,
    }))

    const raw = await readFile(filePath, 'utf-8')
    expect(JSON.parse(raw)).toEqual(['a'])

    const entries = await readdir(tempRoot)
    expect(entries.filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('a corrupt (unparseable) file is backed up, a warning is recorded, and read returns the default', async () => {
    const filePath = join(tempRoot, 'scenes.json')
    writeFileSync(filePath, '{not valid json')
    const store = createJsonFileStore<string[]>(filePath, { defaultValue: [], isValid: isStringArray })

    const data = await store.read()

    expect(data).toEqual([])
    const warnings = getStorageWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.file).toBe(filePath)
    expect(readFileSync(warnings[0]!.backupPath, 'utf-8')).toBe('{not valid json')
    expect(warnings[0]!.backupPath).toMatch(/scenes\.json\.corrupt-.*\.bak$/)
  })

  it('a file with the wrong top-level type is backed up and a warning is recorded', async () => {
    const filePath = join(tempRoot, 'scenes.json')
    writeFileSync(filePath, JSON.stringify({ not: 'an array' }))
    const store = createJsonFileStore<string[]>(filePath, { defaultValue: [], isValid: isStringArray })

    const data = await store.read()

    expect(data).toEqual([])
    expect(getStorageWarnings()).toHaveLength(1)
  })

  it('a repeated read of the same corrupt file does not create duplicate backups or warnings', async () => {
    const filePath = join(tempRoot, 'scenes.json')
    writeFileSync(filePath, '{not valid json')
    const store = createJsonFileStore<string[]>(filePath, { defaultValue: [], isValid: isStringArray })

    await store.read()
    await store.read()
    await store.read()

    expect(getStorageWarnings()).toHaveLength(1)
    const entries = await readdir(tempRoot)
    expect(entries.filter(name => name.includes('.corrupt-'))).toHaveLength(1)
  })

  it('saving after a corrupt read does not destroy the backup file', async () => {
    const filePath = join(tempRoot, 'scenes.json')
    writeFileSync(filePath, '{not valid json')
    const store = createJsonFileStore<string[]>(filePath, { defaultValue: [], isValid: isStringArray })

    await store.update(data => ({
      next: [...data, 'new'],
      result: undefined,
    }))

    const warnings = getStorageWarnings()
    expect(readFileSync(warnings[0]!.backupPath, 'utf-8')).toBe('{not valid json')
    const raw = await readFile(filePath, 'utf-8')
    expect(JSON.parse(raw)).toEqual(['new'])
  })

  posixIt('creates the corrupt-file backup owner-only (0600), not with the source file\'s mode', async () => {
    const filePath = join(tempRoot, 'app-config.json')
    writeFileSync(filePath, '{not valid json', { mode: 0o644 })
    const store = createJsonFileStore<string[]>(filePath, { defaultValue: [], isValid: isStringArray })

    await store.read()

    expect(modeOf(getStorageWarnings()[0]!.backupPath)).toBe(0o600)
  })

  it('passes the corrupt contents through redactBackup before writing the backup', async () => {
    const filePath = join(tempRoot, 'app-config.json')
    writeFileSync(filePath, '{"secret": "trunca')
    const store = createJsonFileStore<Record<string, string>>(filePath, {
      defaultValue: {},
      isValid: isRecord,
      redactBackup: raw => raw.replace('trunca', '[redacted]'),
    })

    await store.read()

    expect(readFileSync(getStorageWarnings()[0]!.backupPath, 'utf-8')).toBe('{"secret": "[redacted]')
  })

  posixIt('repairs an existing world-readable store and its old backups to 0600 on first access', async () => {
    const filePath = join(tempRoot, 'app-config.json')
    const oldBackup = `${filePath}.corrupt-2025-01-01T00-00-00-000Z.bak`
    writeFileSync(filePath, '{"a":"1"}', { mode: 0o644 })
    writeFileSync(oldBackup, '{', { mode: 0o644 })
    const store = createJsonFileStore<Record<string, string>>(filePath, { defaultValue: {}, isValid: isRecord })

    expect(await store.read()).toEqual({ a: '1' })

    expect(modeOf(filePath)).toBe(0o600)
    expect(modeOf(oldBackup)).toBe(0o600)
  })

  it('removes temp files a crashed write left behind, without touching other files', async () => {
    const filePath = join(tempRoot, 'app-config.json')
    writeFileSync(filePath, '{"a":"1"}')
    writeFileSync(`${filePath}.tmp`, '{"a":"stale"}')
    writeFileSync(`${filePath}.0123456789ab.tmp`, '{"a":"stale"}')
    writeFileSync(join(tempRoot, 'scenes.json.tmp'), '[]')
    const store = createJsonFileStore<Record<string, string>>(filePath, { defaultValue: {}, isValid: isRecord })

    await store.read()

    expect((await readdir(tempRoot)).sort()).toEqual(['app-config.json', 'scenes.json.tmp'])
  })

  it('a missing directory on first access is not an error', async () => {
    const filePath = join(tempRoot, 'nested', 'data.json')
    const store = createJsonFileStore<string[]>(filePath, { defaultValue: [], isValid: isStringArray })

    await expect(store.read()).resolves.toEqual([])
  })

  it('update can skip the write when nothing changed', async () => {
    const filePath = join(tempRoot, 'data.json')
    const store = createJsonFileStore<Record<string, string>>(filePath, { defaultValue: {}, isValid: isRecord })

    await store.update(data => ({ next: data, result: undefined, skipWrite: true }))

    await expect(readFile(filePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('queues overlapping update calls so they cannot interleave', async () => {
    const filePath = join(tempRoot, 'counter.json')
    const store = createJsonFileStore<{ count: number }>(filePath, {
      defaultValue: { count: 0 },
      isValid: isRecord,
    })

    await Promise.all(
      Array.from({ length: 20 }, () =>
        store.update((data) => {
          const current = (data as { count: number }).count ?? 0
          return {
            next: { count: current + 1 },
            result: undefined,
          }
        })),
    )

    const final = await store.read()
    expect(final.count).toBe(20)
  })
})

describe('writeJsonFileAtomic', () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-json-atomic-'))
  })

  afterEach(() => {
    openMock.mockImplementation(realOpen)
  })

  /** Records every handle `open` hands out, with a spy on its `sync`. */
  function trackOpenedHandles(failDirectorySync?: NodeJS.ErrnoException) {
    const opened: { path: string, sync: jest.SpyInstance }[] = []
    openMock.mockImplementation(async (...args: Parameters<typeof open>) => {
      const handle: FileHandle = await realOpen(...args)
      const sync = jest.spyOn(handle, 'sync')
      if (failDirectorySync && args[0] === tempRoot)
        sync.mockRejectedValue(failDirectorySync)
      opened.push({
        path: String(args[0]),
        sync,
      })
      return handle
    })
    return opened
  }

  it('fsyncs the temp file before renaming it, then fsyncs the directory', async () => {
    const opened = trackOpenedHandles()
    const filePath = join(tempRoot, 'scenes.json')

    await writeJsonFileAtomic(filePath, ['a'])

    const tmpHandle = opened.find(h => h.path.startsWith(`${filePath}.`) && h.path.endsWith('.tmp'))
    expect(tmpHandle?.sync).toHaveBeenCalledTimes(1)
    const dirHandle = opened.find(h => h.path === tempRoot)
    expect(dirHandle?.sync).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual(['a'])
  })

  it('still completes the write when the platform cannot fsync a directory', async () => {
    trackOpenedHandles(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    const filePath = join(tempRoot, 'app-config.json')

    await expect(writeJsonFileAtomic(filePath, { a: '1' })).resolves.toBeUndefined()

    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ a: '1' })
    expect(await readdir(tempRoot)).toEqual(['app-config.json'])
  })

  it('opens a fresh, randomly named temp file exclusively, owner-only', async () => {
    const filePath = join(tempRoot, 'app-config.json')

    await writeJsonFileAtomic(filePath, { a: '1' })
    await writeJsonFileAtomic(filePath, { a: '2' })

    const tmpOpens = openMock.mock.calls.filter(([path]) => String(path).startsWith(tempRoot) && String(path).endsWith('.tmp'))
    expect(tmpOpens).toHaveLength(2)
    for (const [path, flags, mode] of tmpOpens) {
      expect(String(path)).toMatch(/app-config\.json\.[0-9a-f]{12}\.tmp$/)
      expect(flags).toBe('wx')
      expect(mode).toBe(0o600)
    }
    expect(tmpOpens[0]![0]).not.toBe(tmpOpens[1]![0])
  })

  posixIt('writes the file owner-only (0600) and creates a missing directory 0700', async () => {
    const dir = join(tempRoot, 'data')
    const filePath = join(dir, 'app-config.json')

    await writeJsonFileAtomic(filePath, { 'discord.token': 'secret' })

    expect(modeOf(filePath)).toBe(0o600)
    expect(modeOf(dir)).toBe(0o700)
  })

  it('never writes through a symlink planted at the old fixed temp path', async () => {
    const filePath = join(tempRoot, 'app-config.json')
    const target = join(tempRoot, 'attacker-owned')
    writeFileSync(target, 'untouched')
    symlinkSync(target, `${filePath}.tmp`)

    await writeJsonFileAtomic(filePath, { a: '1' })

    expect(readFileSync(target, 'utf-8')).toBe('untouched')
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ a: '1' })
  })

  it('removes its temp file when the write fails', async () => {
    const filePath = join(tempRoot, 'app-config.json')
    openMock.mockImplementation(async (...args: Parameters<typeof open>) => {
      const handle: FileHandle = await realOpen(...args)
      jest.spyOn(handle, 'writeFile').mockRejectedValue(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }))
      return handle
    })

    await expect(writeJsonFileAtomic(filePath, { a: '1' })).rejects.toThrow('ENOSPC')

    expect(await readdir(tempRoot)).toEqual([])
  })
})
