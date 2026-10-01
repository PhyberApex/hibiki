import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { clearStorageWarnings, getStorageWarnings } from './json-file'
import { createAppConfig } from './persistence'

describe('createAppConfig', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-config-'))
  const config = {
    discord: { token: '' },
    audio: {
      storageRoot: tempRoot,
      musicDir: join(tempRoot, 'music'),
      effectsDir: join(tempRoot, 'effects'),
      webDistDir: 'web-dist',
    },
    database: { path: join(tempRoot, 'data', 'hibiki.json') },
  }

  beforeEach(() => {
    clearStorageWarnings()
  })

  it('get returns null for missing key', async () => {
    const appConfig = createAppConfig(config)
    const val = await appConfig.get('missing')
    expect(val).toBeNull()
  })

  it('set and get roundtrip', async () => {
    const appConfig = createAppConfig(config)
    await appConfig.set('discord.token', 'abc123')
    const val = await appConfig.get('discord.token')
    expect(val).toBe('abc123')
  })

  it('persists to file', async () => {
    const appConfig = createAppConfig(config)
    await appConfig.set('key', 'value')
    const configPath = join(tempRoot, 'data', 'app-config.json')
    const raw = readFileSync(configPath, 'utf-8')
    const data = JSON.parse(raw)
    expect(data.key).toBe('value')
  })

  it('never writes directly to the live file', async () => {
    const appConfig = createAppConfig(config)
    await appConfig.set('atomic', 'true')
    const dataDir = join(tempRoot, 'data')
    const entries = await readdir(dataDir)
    expect(entries).not.toContain('app-config.json.tmp')
  })
})

describe('createAppConfig with a corrupt store', () => {
  let corruptRoot: string
  let corruptConfig: ReturnType<typeof makeCorruptConfig>

  function makeCorruptConfig() {
    const root = mkdtempSync(join(tmpdir(), 'hibiki-config-corrupt-'))
    return {
      discord: { token: '' },
      audio: {
        storageRoot: root,
        musicDir: join(root, 'music'),
        effectsDir: join(root, 'effects'),
        webDistDir: 'web-dist',
      },
      database: { path: join(root, 'data', 'hibiki.json') },
    }
  }

  beforeEach(() => {
    corruptConfig = makeCorruptConfig()
    corruptRoot = corruptConfig.audio.storageRoot
    clearStorageWarnings()
  })

  it('is preserved as a backup, and saving afterwards does not destroy it', async () => {
    const configPath = join(corruptRoot, 'data', 'app-config.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, '{"discord.token": "trunca')

    const appConfig = createAppConfig(corruptConfig)
    const valOnLoad = await appConfig.get('discord.token')
    expect(valOnLoad).toBeNull()

    const warnings = getStorageWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.file).toBe(configPath)
    expect(readFileSync(warnings[0]!.backupPath, 'utf-8')).toBe('{"discord.token": "trunca')

    await appConfig.set('discord.token', 'new-token')
    expect(readFileSync(warnings[0]!.backupPath, 'utf-8')).toBe('{"discord.token": "trunca')
    expect(await appConfig.get('discord.token')).toBe('new-token')
  })

  it('a wrong top-level type (array) is backed up and a warning is recorded', async () => {
    const configPath = join(corruptRoot, 'data', 'app-config.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, '["not", "a", "record"]')

    const appConfig = createAppConfig(corruptConfig)
    const val = await appConfig.get('anything')
    expect(val).toBeNull()
    expect(getStorageWarnings()).toHaveLength(1)
  })
})
