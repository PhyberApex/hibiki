import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
})
