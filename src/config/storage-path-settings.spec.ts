import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStoragePathSettings } from './storage-path-settings'

function setup(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const settings = createStoragePathSettings({
    get: async k => data.get(k) ?? null,
    set: async (k, v) => {
      data.set(k, v)
    },
  })
  return { data, settings }
}

describe('storage path settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'hibiki-storage-path-'))

  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reports no path on a fresh install', async () => {
    await expect(setup().settings.get()).resolves.toEqual({ path: null })
  })

  it('stores an existing absolute directory, trimmed', async () => {
    const { settings } = setup()
    await settings.set(`  ${root}  `)
    await expect(settings.get()).resolves.toEqual({ path: root })
  })

  it('clears the path when given only whitespace', async () => {
    const { settings } = setup()
    await settings.set(root)
    await settings.set('   ')
    await expect(settings.get()).resolves.toEqual({ path: null })
  })

  it('refuses a relative path and keeps the previous one (#776)', async () => {
    const { settings } = setup()
    await settings.set(root)
    await expect(settings.set('sounds')).rejects.toThrow('absolute')
    await expect(settings.get()).resolves.toEqual({ path: root })
  })

  it('refuses a directory that does not exist', async () => {
    await expect(setup().settings.set(join(root, 'missing'))).rejects.toThrow('does not exist')
  })

  it('refuses a file', async () => {
    const file = join(root, 'not-a-folder.txt')
    writeFileSync(file, 'x')
    await expect(setup().settings.set(file)).rejects.toThrow('not a folder')
  })

  // Root ignores permission bits, so this only proves anything as a normal user.
  const asRoot = process.getuid?.() === 0
  ;(asRoot || process.platform === 'win32'
    ? it.skip
    : it)('refuses a folder Hibiki cannot write to', async () => {
    const readOnly = mkdtempSync(join(root, 'read-only-'))
    chmodSync(readOnly, 0o500)
    try {
      await expect(setup().settings.set(readOnly)).rejects.toThrow('writ')
    }
    finally {
      chmodSync(readOnly, 0o700)
    }
  })

  it('refuses a non-string value', async () => {
    await expect(setup().settings.set(42 as unknown as string)).rejects.toThrow()
  })
})
