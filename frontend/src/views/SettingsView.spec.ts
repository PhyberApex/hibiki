import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchLocalOutputDevice,
  fetchSceneFadeLength,
  fetchVisionConfig,
  updateHotkeySettings,
  updateLocalOutputDevice,
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
  fetchHotkeySettings: vi.fn().mockResolvedValue({ enabled: true, stopHotkey: 'F24' }),
  updateHotkeySettings: vi.fn().mockResolvedValue(undefined),
  fetchLocalOutputDevice: vi.fn().mockResolvedValue(null),
  updateLocalOutputDevice: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/hotkeys', () => ({
  fetchHotkeyStatus: vi.fn().mockResolvedValue({
    enabled: true,
    registered: [],
    failures: [{ accelerator: 'F13', owner: 'Scene "Tavern"', reason: 'Global hotkeys are not supported under Wayland' }],
  }),
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
    expect(wrapper.find('h2').text()).toBe('Discord bot (optional)')
    expect(wrapper.text()).toContain('only needed to play into Discord')
    expect(wrapper.text()).toContain('No token — optional')
  })

  it('renders Storage location section', async () => {
    const wrapper = mount(SettingsView, {
      global: { plugins: [createPinia()] },
    })
    await flushPromises()
    const headings = wrapper.findAll('h2')
    expect(headings.some(h => h.text() === 'Storage location')).toBe(true)
  })

  describe('hotkeys section', () => {
    it('shows the Stop Hotkey and saves the enable toggle', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find('[data-testid="hotkeys-section"]').text()).toContain('F24')
      await wrapper.find('#hotkeys-enabled').setValue(false)
      await flushPromises()
      expect(updateHotkeySettings).toHaveBeenCalledWith({ enabled: false, stopHotkey: 'F24' })
    })

    it('binds the Stop Hotkey and shows a rejection inline', async () => {
      vi.mocked(updateHotkeySettings).mockRejectedValueOnce(new Error('F13 is already used by Scene \'Tavern\''))
      const wrapper = mountSettings()
      await flushPromises()
      const button = wrapper.find('[data-testid="hotkeys-section"] [data-testid="hotkey-recorder-button"]')
      await button.trigger('click')
      await button.trigger('keydown', { code: 'F13' })
      await flushPromises()
      expect(updateHotkeySettings).toHaveBeenCalledWith({ enabled: true, stopHotkey: 'F13' })
      expect(wrapper.find('[data-testid="hotkey-recorder-error"]').text()).toContain('Tavern')
    })

    it('offers six Action Hotkey rows in order and binds the Volume Up row', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      const labels = wrapper.findAll('[data-testid="hotkeys-section"] .field-label').map(l => l.text())
      expect(labels).toEqual(['Stop Scene', 'Stop all Effects', 'Previous Scene', 'Next Scene', 'Volume Down', 'Volume Up'])
      const buttons = wrapper.findAll('[data-testid="hotkeys-section"] [data-testid="hotkey-recorder-button"]')
      await buttons[5].trigger('click')
      await buttons[5].trigger('keydown', { code: 'F14' })
      await flushPromises()
      expect(updateHotkeySettings).toHaveBeenCalledWith({ enabled: true, stopHotkey: 'F24', volumeUpHotkey: 'F14' })
    })

    it('lists refused hotkeys with the reason under Diagnostics', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      const failures = wrapper.find('[data-testid="hotkey-failures"]')
      expect(failures.text()).toContain('F13')
      expect(failures.text()).toContain('Wayland')
    })
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

describe('settingsView Local playback', () => {
  type Handler = () => void
  let handlers: Handler[]

  function stubDevices(devices: Array<{ deviceId: string, label: string, kind?: string }>) {
    handlers = []
    const enumerateDevices = vi.fn(async () => devices.map(d => ({ kind: 'audiooutput', ...d })))
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices,
        addEventListener: (_: string, h: Handler) => handlers.push(h),
        removeEventListener: vi.fn(),
      },
    })
    return enumerateDevices
  }

  function options(wrapper: ReturnType<typeof mountSettings>) {
    return wrapper.findAll('#output-device option').map(o => o.text())
  }

  it('lists System default first, then device labels, numbering empty ones', async () => {
    stubDevices([{ deviceId: 'a', label: 'USB Speaker' }, { deviceId: 'b', label: '' }, { deviceId: 'default', label: 'Default' }])
    const wrapper = mountSettings()
    await flushPromises()
    expect(options(wrapper)).toEqual(['System default', 'USB Speaker', 'Output device 2'])
    expect(wrapper.text()).toContain('Browser tab always plays through the system default')
  })

  it('keeps an absent stored device selected as "(not connected)"', async () => {
    stubDevices([{ deviceId: 'a', label: 'Built-in Output' }])
    vi.mocked(fetchLocalOutputDevice).mockResolvedValueOnce({ deviceId: 'gone', label: 'USB Speaker' })
    const wrapper = mountSettings()
    await flushPromises()
    expect(options(wrapper)).toEqual(['System default', 'Built-in Output', 'USB Speaker (not connected)'])
    expect((wrapper.find('#output-device').element as HTMLSelectElement).value).toBe('gone')
  })

  it('saves the selection with its label, and clears it for System default', async () => {
    stubDevices([{ deviceId: 'a', label: 'USB Speaker' }])
    const wrapper = mountSettings()
    await flushPromises()
    await wrapper.find('#output-device').setValue('a')
    expect(updateLocalOutputDevice).toHaveBeenLastCalledWith({ deviceId: 'a', label: 'USB Speaker' })
    await wrapper.find('#output-device').setValue('')
    expect(updateLocalOutputDevice).toHaveBeenLastCalledWith(null)
  })

  it('re-lists devices on devicechange', async () => {
    const enumerate = stubDevices([{ deviceId: 'a', label: 'USB Speaker' }])
    const wrapper = mountSettings()
    await flushPromises()
    enumerate.mockResolvedValue([{ kind: 'audiooutput', deviceId: 'a', label: 'USB Speaker' }, { kind: 'audiooutput', deviceId: 'c', label: 'HDMI' }] as never)
    handlers.forEach(h => h())
    await flushPromises()
    expect(options(wrapper)).toEqual(['System default', 'USB Speaker', 'HDMI'])
  })
})
