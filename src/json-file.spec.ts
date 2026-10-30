import type { FileHandle } from 'node:fs/promises'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
    expect(entries).not.toContain('data.json.tmp')
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

    const tmpHandle = opened.find(h => h.path === `${filePath}.tmp`)
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
})
