import type { SecretCodec } from './persistence'
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

describe('createAppConfig with a secret codec', () => {
  let secretConfig: ReturnType<typeof makeSecretConfig>

  function makeSecretConfig() {
    const root = mkdtempSync(join(tmpdir(), 'hibiki-config-secrets-'))
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

  function fakeCodec(available = true): SecretCodec {
    return {
      available,
      encrypt: value => `enc(${value})`,
      decrypt: (value) => {
        const match = /^enc\((.*)\)$/.exec(value)
        if (!match)
          throw new Error('cannot decrypt')
        return match[1]
      },
    }
  }

  function readStoredConfig(): Record<string, string> {
    const configPath = join(secretConfig.audio.storageRoot, 'data', 'app-config.json')
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  }

  beforeEach(() => {
    secretConfig = makeSecretConfig()
    clearStorageWarnings()
  })

  it('encrypts a secret key on write, and decrypts it back on read', async () => {
    const appConfig = createAppConfig(secretConfig, fakeCodec())
    await appConfig.set('discord.token', 'abc123')

    expect(readStoredConfig()['discord.token']).toBe('enc:v1:enc(abc123)')
    expect(await appConfig.get('discord.token')).toBe('abc123')
  })

  it('never encrypts a non-secret key', async () => {
    const appConfig = createAppConfig(secretConfig, fakeCodec())
    await appConfig.set('storage.path', '/tmp/music')

    expect(readStoredConfig()['storage.path']).toBe('/tmp/music')
  })

  it('migrates a legacy plaintext secret to encrypted storage on read', async () => {
    const configPath = join(secretConfig.audio.storageRoot, 'data', 'app-config.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ 'discord.token': 'legacy-plain' }))

    const appConfig = createAppConfig(secretConfig, fakeCodec())
    expect(await appConfig.get('discord.token')).toBe('legacy-plain')
    expect(readStoredConfig()['discord.token']).toBe('enc:v1:enc(legacy-plain)')
  })

  it('treats an undecryptable value as not configured, not a crash', async () => {
    const configPath = join(secretConfig.audio.storageRoot, 'data', 'app-config.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ 'discord.token': 'enc:v1:garbage' }))

    const appConfig = createAppConfig(secretConfig, fakeCodec())
    await expect(appConfig.get('discord.token')).resolves.toBeNull()
  })

  it('falls back to plaintext storage when the codec is unavailable', async () => {
    const appConfig = createAppConfig(secretConfig, fakeCodec(false))
    await appConfig.set('discord.token', 'plain-token')

    expect(readStoredConfig()['discord.token']).toBe('plain-token')
    expect(await appConfig.get('discord.token')).toBe('plain-token')
    expect(appConfig.secretsEncrypted).toBe(false)
  })

  it('does not migrate a legacy plaintext secret when the codec is unavailable', async () => {
    const configPath = join(secretConfig.audio.storageRoot, 'data', 'app-config.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ 'discord.token': 'legacy-plain' }))

    const appConfig = createAppConfig(secretConfig, fakeCodec(false))
    expect(await appConfig.get('discord.token')).toBe('legacy-plain')
    expect(readStoredConfig()['discord.token']).toBe('legacy-plain')
  })

  it('reports secretsEncrypted based on codec availability', () => {
    expect(createAppConfig(secretConfig, fakeCodec(true)).secretsEncrypted).toBe(true)
    expect(createAppConfig(secretConfig, fakeCodec(false)).secretsEncrypted).toBe(false)
  })
})
