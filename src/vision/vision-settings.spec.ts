import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppConfig } from '../persistence'
import { createVisionSettings } from './vision-settings'

function makeConfig(apiKeyFromEnv: string) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-vision-settings-'))
  return {
    discord: { token: '' },
    vision: { apiKey: apiKeyFromEnv },
    audio: {
      storageRoot: tempRoot,
      musicDir: join(tempRoot, 'music'),
      effectsDir: join(tempRoot, 'effects'),
      ambienceDir: join(tempRoot, 'ambience'),
      webDistDir: 'web-dist',
    },
    database: { path: join(tempRoot, 'data', 'hibiki.json') },
  }
}

describe('createVisionSettings', () => {
  it('starts with no key and the feature off', async () => {
    const config = makeConfig('')
    const settings = createVisionSettings(config, createAppConfig(config))
    expect(await settings.get()).toEqual({ apiKeyConfigured: false, enabled: false })
    expect(await settings.getApiKey()).toBeNull()
  })

  it('stores a trimmed key and reports it configured', async () => {
    const config = makeConfig('')
    const settings = createVisionSettings(config, createAppConfig(config))
    expect(await settings.setApiKey('  sk-stored  ')).toEqual({ apiKeyConfigured: true, enabled: false })
    expect(await settings.getApiKey()).toBe('sk-stored')
  })

  it('prefers the environment key over the stored one, like the Discord token', async () => {
    const config = makeConfig('sk-env')
    const settings = createVisionSettings(config, createAppConfig(config))
    await settings.setApiKey('sk-stored')
    expect(await settings.getApiKey()).toBe('sk-env')
  })

  it('clearing the stored key leaves the feature unconfigured', async () => {
    const config = makeConfig('')
    const settings = createVisionSettings(config, createAppConfig(config))
    await settings.setApiKey('sk-stored')
    expect(await settings.setApiKey('')).toEqual({ apiKeyConfigured: false, enabled: false })
  })

  it('persists the enabled toggle across instances', async () => {
    const config = makeConfig('')
    const appConfig = createAppConfig(config)
    await createVisionSettings(config, appConfig).setEnabled(true)
    expect(await createVisionSettings(config, appConfig).get()).toEqual({ apiKeyConfigured: false, enabled: true })
  })
})
