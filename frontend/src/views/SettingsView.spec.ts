import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchSceneFadeLength,
  fetchVisionConfig,
  updateSceneFadeLength,
  updateVisionApiKey,
  updateVisionEnabled,
  updateVisionOpenAiBaseUrl,
  updateVisionOpenAiModel,
  updateVisionProvider,
} from '@/api/config'
import { useAccessibilityStore } from '@/stores/accessibility'
import SettingsView from './SettingsView.vue'

const UNCONFIGURED_VISION = {
  provider: 'claude' as const,
  enabled: false,
  configured: false,
  claude: { keyConfigured: false, configured: false },
  openaiCompatible: { keyConfigured: false, configured: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' },
}

const CLAUDE_CONFIGURED_VISION = {
  ...UNCONFIGURED_VISION,
  configured: true,
  claude: { keyConfigured: true, configured: true },
}

vi.mock('@/api/config', () => ({
  fetchDiscordConfig: vi.fn().mockResolvedValue({ tokenConfigured: false }),
  fetchStoragePath: vi.fn().mockResolvedValue({ path: null }),
  fetchVisionConfig: vi.fn().mockResolvedValue({
    provider: 'claude',
    enabled: false,
    configured: false,
    claude: { keyConfigured: false, configured: false },
    openaiCompatible: { keyConfigured: false, configured: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' },
  }),
  selectStorageFolder: vi.fn(),
  updateDiscordToken: vi.fn().mockResolvedValue({ tokenConfigured: true }),
  updateStoragePath: vi.fn().mockResolvedValue(undefined),
  fetchAccessibilitySettings: vi.fn().mockResolvedValue({ luminancePulses: true, reduceMotion: null }),
  updateAccessibilitySettings: vi.fn().mockResolvedValue(undefined),
  fetchSceneFadeLength: vi.fn().mockResolvedValue(3),
  updateSceneFadeLength: vi.fn().mockResolvedValue(undefined),
  SCENE_FADE_LENGTH_MIN_SECONDS: 0,
  SCENE_FADE_LENGTH_MAX_SECONDS: 10,
  SCENE_FADE_LENGTH_STEP_SECONDS: 0.5,
  updateVisionProvider: vi.fn(),
  updateVisionApiKey: vi.fn(),
  updateVisionOpenAiBaseUrl: vi.fn(),
  updateVisionOpenAiModel: vi.fn(),
  updateVisionEnabled: vi.fn(),
}))

function mountSettings() {
  return mount(SettingsView, {
    global: { plugins: [createPinia()] },
  })
}

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
}

describe('settingsView', () => {
  it('renders Settings heading', async () => {
    const wrapper = mount(SettingsView, {
      global: { plugins: [createPinia()] },
    })
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Settings')
  })

  it('renders Discord bot section', async () => {
    const wrapper = mount(SettingsView, {
      global: { plugins: [createPinia()] },
    })
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('Discord bot')
  })

  it('renders Storage location section', async () => {
    const wrapper = mount(SettingsView, {
      global: { plugins: [createPinia()] },
    })
    await flushPromises()
    const headings = wrapper.findAll('h2')
    expect(headings.some(h => h.text() === 'Storage location')).toBe(true)
  })

  describe('accessibility section', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia
    })

    it('renders the Accessibility section with both toggles on their defaults', async () => {
      stubMatchMedia(false)
      const wrapper = mount(SettingsView, {
        global: { plugins: [createPinia()] },
      })
      await flushPromises()
      const headings = wrapper.findAll('h2')
      expect(headings.some(h => h.text() === 'Accessibility')).toBe(true)
      const pulses = wrapper.find<HTMLInputElement>('#luminance-pulses')
      const reduceMotion = wrapper.find<HTMLInputElement>('#reduce-motion')
      expect(pulses.element.checked).toBe(true)
      expect(reduceMotion.element.checked).toBe(false)
      expect(wrapper.find('.motion-source').text()).toContain('system')
      expect(wrapper.find('.btn-motion-reset').exists()).toBe(false)
    })

    it('reduce motion defaults to the OS preference', async () => {
      stubMatchMedia(true)
      const wrapper = mount(SettingsView, {
        global: { plugins: [createPinia()] },
      })
      await flushPromises()
      expect(wrapper.find<HTMLInputElement>('#reduce-motion').element.checked).toBe(true)
    })

    it('persists turning luminance pulses off', async () => {
      stubMatchMedia(false)
      const { updateAccessibilitySettings } = await import('@/api/config')
      const wrapper = mount(SettingsView, {
        global: { plugins: [createPinia()] },
      })
      await flushPromises()
      await wrapper.find('#luminance-pulses').setValue(false)
      await flushPromises()
      expect(updateAccessibilitySettings).toHaveBeenCalledWith({ luminancePulses: false, reduceMotion: null })
    })

    it('overrides reduce motion in either direction and can return to the system setting', async () => {
      stubMatchMedia(true)
      const { updateAccessibilitySettings } = await import('@/api/config')
      const pinia = createPinia()
      const wrapper = mount(SettingsView, {
        global: { plugins: [pinia] },
      })
      await flushPromises()
      const store = useAccessibilityStore(pinia)

      await wrapper.find('#reduce-motion').setValue(false)
      await flushPromises()
      expect(updateAccessibilitySettings).toHaveBeenLastCalledWith({ luminancePulses: true, reduceMotion: false })
      expect(store.reduceMotion).toBe(false)
      expect(wrapper.find('.btn-motion-reset').exists()).toBe(true)

      await wrapper.find('#reduce-motion').setValue(true)
      await flushPromises()
      expect(updateAccessibilitySettings).toHaveBeenLastCalledWith({ luminancePulses: true, reduceMotion: true })

      await wrapper.find('.btn-motion-reset').trigger('click')
      await flushPromises()
      expect(updateAccessibilitySettings).toHaveBeenLastCalledWith({ luminancePulses: true, reduceMotion: null })
      expect(store.followsSystemMotion).toBe(true)
      expect(wrapper.find<HTMLInputElement>('#reduce-motion').element.checked).toBe(true)
    })
  })

  describe('scene transitions section', () => {
    beforeEach(() => {
      vi.mocked(fetchSceneFadeLength).mockResolvedValue(3)
    })

    it('renders the Scene transitions section with the stored value', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      const headings = wrapper.findAll('h2')
      expect(headings.some(h => h.text() === 'Scene transitions')).toBe(true)
      const slider = wrapper.find<HTMLInputElement>('#scene-fade-length')
      expect(slider.element.value).toBe('3')
      expect(slider.element.min).toBe('0')
      expect(slider.element.max).toBe('10')
      expect(slider.element.step).toBe('0.5')
      expect(wrapper.find('.fade-value').text()).toBe('3s')
    })

    it('shows "Hard cut" at 0 seconds', async () => {
      vi.mocked(fetchSceneFadeLength).mockResolvedValue(0)
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find('.fade-value').text()).toBe('Hard cut')
    })

    it('saves the fade length on change', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      await wrapper.find('#scene-fade-length').setValue('4.5')
      await flushPromises()
      expect(updateSceneFadeLength).toHaveBeenCalledWith(4.5)
      expect(wrapper.find('.fade-value').text()).toBe('4.5s')
    })
  })

  describe('vision to Vibe section', () => {
    beforeEach(() => {
      vi.mocked(fetchVisionConfig).mockResolvedValue(UNCONFIGURED_VISION)
      vi.mocked(updateVisionApiKey).mockResolvedValue(CLAUDE_CONFIGURED_VISION)
      vi.mocked(updateVisionEnabled).mockResolvedValue({ ...CLAUDE_CONFIGURED_VISION, enabled: true })
      vi.mocked(updateVisionProvider).mockResolvedValue({
        ...UNCONFIGURED_VISION,
        provider: 'openai-compatible',
      })
      vi.mocked(updateVisionOpenAiBaseUrl).mockResolvedValue(UNCONFIGURED_VISION)
      vi.mocked(updateVisionOpenAiModel).mockResolvedValue(UNCONFIGURED_VISION)
    })

    it('renders the section with a third-party disclosure naming Claude by default', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      const headings = wrapper.findAll('h2')
      expect(headings.some(h => h.text() === 'Vision to Vibe')).toBe(true)
      expect(wrapper.text()).toContain('Anthropic')
    })

    it('saves the Claude API key', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      await wrapper.find('#vision-api-key').setValue('sk-ant-123')
      await wrapper.find('[data-testid="vision-save-key"]').trigger('click')
      await flushPromises()
      expect(updateVisionApiKey).toHaveBeenCalledWith('claude', 'sk-ant-123')
      expect(wrapper.text()).toContain('Key saved')
    })

    it('shows the toggle disabled until the selected provider is configured', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      const toggle = wrapper.find<HTMLInputElement>('#vision-enabled')
      expect(toggle.element.disabled).toBe(true)
    })

    it('toggles the feature on when the provider is configured', async () => {
      vi.mocked(fetchVisionConfig).mockResolvedValue(CLAUDE_CONFIGURED_VISION)
      const wrapper = mountSettings()
      await flushPromises()
      const toggle = wrapper.find<HTMLInputElement>('#vision-enabled')
      expect(toggle.element.disabled).toBe(false)
      await toggle.setValue(true)
      await flushPromises()
      expect(updateVisionEnabled).toHaveBeenCalledWith(true)
    })

    it('does not show Base URL/Model fields for Claude', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find('#vision-base-url').exists()).toBe(false)
      expect(wrapper.find('#vision-model').exists()).toBe(false)
    })

    it('switches to the OpenAI-compatible provider and shows its fields', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      await wrapper.find('#vision-provider').setValue('openai-compatible')
      await flushPromises()
      expect(updateVisionProvider).toHaveBeenCalledWith('openai-compatible')
      expect(wrapper.find('#vision-base-url').exists()).toBe(true)
      expect(wrapper.find('#vision-model').exists()).toBe(true)
      expect(wrapper.text()).toContain('endpoint configured below')
    })

    it('saves a custom Base URL for the OpenAI-compatible provider', async () => {
      vi.mocked(fetchVisionConfig).mockResolvedValue({ ...UNCONFIGURED_VISION, provider: 'openai-compatible' })
      vi.mocked(updateVisionOpenAiBaseUrl).mockResolvedValue({
        ...UNCONFIGURED_VISION,
        provider: 'openai-compatible',
        configured: true,
        openaiCompatible: { keyConfigured: false, configured: true, baseUrl: 'http://localhost:11434/v1', model: 'gpt-6-astra' },
      })
      const wrapper = mountSettings()
      await flushPromises()
      await wrapper.find('#vision-base-url').setValue('http://localhost:11434/v1')
      await wrapper.find('[data-testid="vision-save-base-url"]').trigger('click')
      await flushPromises()
      expect(updateVisionOpenAiBaseUrl).toHaveBeenCalledWith('http://localhost:11434/v1')
      expect(wrapper.find<HTMLInputElement>('#vision-enabled').element.disabled).toBe(false)
    })

    it('resets the Model back to the default', async () => {
      vi.mocked(fetchVisionConfig).mockResolvedValue({
        ...UNCONFIGURED_VISION,
        provider: 'openai-compatible',
        openaiCompatible: { keyConfigured: false, configured: false, baseUrl: 'https://api.openai.com/v1', model: 'llava' },
      })
      vi.mocked(updateVisionOpenAiModel).mockResolvedValue({
        ...UNCONFIGURED_VISION,
        provider: 'openai-compatible',
        openaiCompatible: { keyConfigured: false, configured: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' },
      })
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find<HTMLInputElement>('#vision-model').element.value).toBe('llava')
      await wrapper.find('[data-testid="vision-reset-model"]').trigger('click')
      await flushPromises()
      expect(updateVisionOpenAiModel).toHaveBeenCalledWith('')
      expect(wrapper.find<HTMLInputElement>('#vision-model').element.value).toBe('gpt-6-astra')
    })
  })
})
