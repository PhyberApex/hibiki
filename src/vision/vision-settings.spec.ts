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
    database: {
      path: join(tempRoot, 'data', 'hibiki.json'),
    },
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
      openaiCompatible: {
        keyConfigured: false,
        configured: false,
        encrypted: false,
        baseUrl: OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
        model: OPENAI_COMPATIBLE_DEFAULT_MODEL,
        keyWithheld: false,
      },
    })
  })

  it('reports both Vision keys encrypted when secrets are encrypted at rest', async () => {
    const config = makeConfig()
    const codec = {
      available: true,
      encrypt: async (value: string) => value,
      decrypt: async (value: string) => ({ result: value, shouldReEncrypt: false }),
    }
    const settings = createVisionSettings(config, createAppConfig(config, codec))
    const state = await settings.setApiKey('openai-compatible', 'sk-openai')
    expect(state.openaiCompatible.encrypted).toBe(true)
    expect(state.claude.encrypted).toBe(true)
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

  describe('openai-compatible Base URL guard (#767)', () => {
    it.each([
      'http://169.254.169.254/latest/meta-data',
      'https://evil.test/collect?x=',
      'https://api.openai.com/v1#',
      'https://sk-secret@gateway.example/v1',
      'http://box.lan/v1',
      'javascript:alert(1)',
    ])('rejects %s and keeps the previous Base URL', async (baseUrl) => {
      const config = makeConfig()
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setOpenAiBaseUrl('https://gateway.example/v1')
      await expect(settings.setOpenAiBaseUrl(baseUrl)).rejects.toThrow()
      expect((await settings.get()).openaiCompatible.baseUrl).toBe('https://gateway.example/v1')
    })

    it('withholds a stored key from a Base URL on another origin, and sends it again on the original', async () => {
      const config = makeConfig()
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setProvider('openai-compatible')
      await settings.setApiKey('openai-compatible', 'sk-openai')

      let state = await settings.setOpenAiBaseUrl('https://hibiki-fast.example/v1')
      expect(state.openaiCompatible.keyConfigured).toBe(false)
      expect(state.openaiCompatible.keyWithheld).toBe(true)
      expect((await settings.getProviderConfig()).apiKey).toBeNull()

      state = await settings.setOpenAiBaseUrl('')
      expect(state.openaiCompatible.keyConfigured).toBe(true)
      expect(state.openaiCompatible.keyWithheld).toBe(false)
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-openai')
    })

    it('binds a key entered for a custom endpoint to that endpoint only', async () => {
      const config = makeConfig()
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setProvider('openai-compatible')
      await settings.setOpenAiBaseUrl('https://openrouter.ai/api/v1')
      await settings.setApiKey('openai-compatible', 'sk-or')
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-or')

      await settings.setOpenAiBaseUrl('https://openrouter.ai/api/v2')
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-or')

      await settings.setOpenAiBaseUrl('https://elsewhere.example/v1')
      expect((await settings.getProviderConfig()).apiKey).toBeNull()
    })

    it('pins a key saved before binding existed to the Base URL it was used with', async () => {
      const config = makeConfig()
      const appConfig = createAppConfig(config)
      await appConfig.set('vision.openai.baseUrl', 'https://openrouter.ai/api/v1')
      await appConfig.set('vision.openai.apiKey', 'sk-legacy')
      const settings = createVisionSettings(config, appConfig)
      await settings.setProvider('openai-compatible')
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-legacy')

      await settings.setOpenAiBaseUrl('https://hibiki-fast.example/v1')
      expect((await settings.getProviderConfig()).apiKey).toBeNull()
      await settings.setOpenAiBaseUrl('https://openrouter.ai/api/v1')
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-legacy')
    })

    it('withholds a pre-binding key everywhere when the Base URL it was used with is invalid', async () => {
      const config = makeConfig()
      const appConfig = createAppConfig(config)
      await appConfig.set('vision.openai.baseUrl', 'not a url')
      await appConfig.set('vision.openai.apiKey', 'sk-legacy')
      const settings = createVisionSettings(config, appConfig)
      await settings.setProvider('openai-compatible')

      const state = await settings.setOpenAiBaseUrl('https://hibiki-fast.example/v1')
      expect(state.openaiCompatible.keyWithheld).toBe(true)
      expect((await settings.getProviderConfig()).apiKey).toBeNull()
    })

    it('does not let a key saved under an invalid Base URL follow the next Base URL', async () => {
      const config = makeConfig()
      const appConfig = createAppConfig(config)
      await appConfig.set('vision.openai.baseUrl', 'not a url')
      const settings = createVisionSettings(config, appConfig)
      await settings.setProvider('openai-compatible')
      await settings.setApiKey('openai-compatible', 'sk-typed')

      await settings.setOpenAiBaseUrl('https://hibiki-fast.example/v1')
      expect((await settings.getProviderConfig()).apiKey).toBeNull()
    })

    it('sends the env key only to OpenAI itself', async () => {
      const config = makeConfig({ openaiKey: 'sk-env' })
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setProvider('openai-compatible')
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-env')

      const state = await settings.setOpenAiBaseUrl('https://hibiki-fast.example/v1')
      expect(state.openaiCompatible.keyWithheld).toBe(true)
      expect((await settings.getProviderConfig()).apiKey).toBeNull()
    })

    it('falls back to a key saved in Settings for a custom endpoint when the env key is set', async () => {
      const config = makeConfig({ openaiKey: 'sk-env' })
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setProvider('openai-compatible')
      await settings.setOpenAiBaseUrl('https://openrouter.ai/api/v1')
      const state = await settings.setApiKey('openai-compatible', 'sk-or')
      expect(state.openaiCompatible.keyConfigured).toBe(true)
      expect(state.openaiCompatible.keyWithheld).toBe(false)
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-or')

      await settings.setOpenAiBaseUrl('')
      expect((await settings.getProviderConfig()).apiKey).toBe('sk-env')
    })

    it('clearing the key clears its binding', async () => {
      const config = makeConfig()
      const settings = createVisionSettings(config, createAppConfig(config))
      await settings.setApiKey('openai-compatible', 'sk-openai')
      const state = await settings.setApiKey('openai-compatible', '')
      expect(state.openaiCompatible.keyConfigured).toBe(false)
      expect(state.openaiCompatible.keyWithheld).toBe(false)
    })
  })
})
