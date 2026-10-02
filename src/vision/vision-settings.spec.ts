import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppConfig } from '../persistence'
import { createVisionSettings } from './vision-settings'
import { OPENAI_COMPATIBLE_DEFAULT_BASE_URL, OPENAI_COMPATIBLE_DEFAULT_MODEL } from './vision.service'

function makeConfig(env: { claudeKey?: string, openaiKey?: string } = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-vision-settings-'))
  return {
    discord: { token: '' },
    vision: { apiKey: env.claudeKey ?? '', openaiApiKey: env.openaiKey ?? '' },
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
  it('defaults to Claude selected, unconfigured, and the feature off', async () => {
    const config = makeConfig()
    const settings = createVisionSettings(config, createAppConfig(config))
    expect(await settings.get()).toEqual({
      provider: 'claude',
      enabled: false,
      configured: false,
      claude: { keyConfigured: false, configured: false, encrypted: false },
      openaiCompatible: { keyConfigured: false, configured: false, baseUrl: OPENAI_COMPATIBLE_DEFAULT_BASE_URL, model: OPENAI_COMPATIBLE_DEFAULT_MODEL },
    })
  })

  it('stores a trimmed Claude key and reports it configured', async () => {
    const config = makeConfig()
    const settings = createVisionSettings(config, createAppConfig(config))
    const state = await settings.setApiKey('claude', '  sk-stored  ')
    expect(state.claude).toEqual({ keyConfigured: true, configured: true, encrypted: false })
    expect(state.configured).toBe(true)
    expect((await settings.getProviderConfig()).apiKey).toBe('sk-stored')
  })

  it('prefers the environment key over the stored Claude key, like the Discord token', async () => {
    const config = makeConfig({ claudeKey: 'sk-env' })
    const settings = createVisionSettings(config, createAppConfig(config))
    await settings.setApiKey('claude', 'sk-stored')
    expect((await settings.getProviderConfig()).apiKey).toBe('sk-env')
  })

  it('clearing the stored Claude key leaves it unconfigured', async () => {
    const config = makeConfig()
    const settings = createVisionSettings(config, createAppConfig(config))
    await settings.setApiKey('claude', 'sk-stored')
    const state = await settings.setApiKey('claude', '')
    expect(state.claude).toEqual({ keyConfigured: false, configured: false, encrypted: false })
  })

  it('removing a stored Claude key while its env key is set keeps it configured', async () => {
    const config = makeConfig({ claudeKey: 'sk-env' })
    const settings = createVisionSettings(config, createAppConfig(config))
    await settings.setApiKey('claude', 'sk-stored')
    const state = await settings.setApiKey('claude', '')
    expect(state.claude).toEqual({ keyConfigured: true, configured: true, encrypted: false })
  })

  it('persists the enabled toggle and selected provider across instances', async () => {
    const config = makeConfig()
    const appConfig = createAppConfig(config)
    await createVisionSettings(config, appConfig).setEnabled(true)
    await createVisionSettings(config, appConfig).setProvider('openai-compatible')
    const state = await createVisionSettings(config, appConfig).get()
    expect(state.enabled).toBe(true)
    expect(state.provider).toBe('openai-compatible')
  })

  it('keeps each provider key independent when switching back and forth', async () => {
    const config = makeConfig()
    const appConfig = createAppConfig(config)
    const settings = createVisionSettings(config, appConfig)
    await settings.setApiKey('claude', 'sk-claude')
    await settings.setProvider('openai-compatible')
    await settings.setApiKey('openai-compatible', 'sk-openai')
    await settings.setProvider('claude')

    const state = await settings.get()
    expect(state.provider).toBe('claude')
    expect(state.claude.keyConfigured).toBe(true)
    expect(state.openaiCompatible.keyConfigured).toBe(true)
    expect((await settings.getProviderConfig()).apiKey).toBe('sk-claude')
  })

  describe('openai-compatible gating', () => {
    it('is unconfigured with the default Base URL and no key', async () => {
      const config = makeConfig()
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setProvider('openai-compatible')
      const state = await settings.get()
      expect(state.openaiCompatible.configured).toBe(false)
      expect(state.configured).toBe(false)
    })

    it('is configured once a key is set, even with the default Base URL', async () => {
      const config = makeConfig()
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setProvider('openai-compatible')
      await settings.setApiKey('openai-compatible', 'sk-openai')
      const state = await settings.get()
      expect(state.openaiCompatible.configured).toBe(true)
      expect(state.configured).toBe(true)
    })

    it('is configured with a custom Base URL and no key, for local servers', async () => {
      const config = makeConfig()
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setProvider('openai-compatible')
      await settings.setOpenAiBaseUrl('http://localhost:11434/v1')
      const state = await settings.get()
      expect(state.openaiCompatible.configured).toBe(true)
      expect(state.configured).toBe(true)
      const providerConfig = await settings.getProviderConfig()
      expect(providerConfig.apiKey).toBeNull()
      expect(providerConfig.baseUrl).toBe('http://localhost:11434/v1')
    })

    it('prefers the env key over the stored one and takes precedence, independent of the Claude key', async () => {
      const config = makeConfig({ openaiKey: 'sk-openai-env', claudeKey: 'sk-claude-env' })
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setProvider('openai-compatible')
      await settings.setApiKey('openai-compatible', 'sk-openai-stored')
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-openai-env')

      await settings.setProvider('claude')
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-claude-env')
    })

    it('clearing Base URL or Model restores the default', async () => {
      const config = makeConfig()
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setProvider('openai-compatible')
      await settings.setOpenAiBaseUrl('http://localhost:11434/v1')
      await settings.setOpenAiModel('llava')
      await settings.setOpenAiBaseUrl('')
      const state = await settings.setOpenAiModel('')
      expect(state.openaiCompatible.baseUrl).toBe(OPENAI_COMPATIBLE_DEFAULT_BASE_URL)
      expect(state.openaiCompatible.model).toBe(OPENAI_COMPATIBLE_DEFAULT_MODEL)
    })
  })
})
