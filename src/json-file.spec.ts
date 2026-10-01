import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearStorageWarnings, createJsonFileStore, getStorageWarnings } from './json-file'

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

    await store.update(data => ({ next: [...data, 'a'], result: undefined }))

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

  it('saving after a corrupt read does not destroy the backup file', async () => {
    const filePath = join(tempRoot, 'scenes.json')
    writeFileSync(filePath, '{not valid json')
    const store = createJsonFileStore<string[]>(filePath, { defaultValue: [], isValid: isStringArray })

    await store.update(data => ({ next: [...data, 'new'], result: undefined }))

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
    const store = createJsonFileStore<{ count: number }>(filePath, { defaultValue: { count: 0 }, isValid: isRecord })

    await Promise.all(
      Array.from({ length: 20 }, () =>
        store.update((data) => {
          const current = (data as { count: number }).count ?? 0
          return { next: { count: current + 1 }, result: undefined }
        })),
    )

    const final = await store.read()
    expect(final.count).toBe(20)
  })
})
