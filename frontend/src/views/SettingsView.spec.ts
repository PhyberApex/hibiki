import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import {
  clearDiscordToken,
  fetchDiscordConfig,
  fetchLocalOutputDevice,
  fetchSceneFadeLength,
  fetchVisionConfig,
  updateDiscordToken,
  updateHotkeySettings,
  updateLocalOutputDevice,
  updateSceneFadeLength,
  updateVisionApiKey,
  updateVisionEnabled,
  updateVisionOpenAiBaseUrl,
  updateVisionOpenAiModel,
  updateVisionProvider,
} from '@/api/config'
import { fetchHotkeyStatus } from '@/api/hotkeys'
import { copyDiagnostics } from '@/api/logs'
import { fetchUpdateCheckSettings, updateUpdateCheckEnabled } from '@/api/updates'
import { fetchUsageStats, updateUsageStatsEnabled } from '@/api/usage-stats'
import { useAccessibilityStore } from '@/stores/accessibility'
import { usePlayerStore } from '@/stores/player'
import SettingsView from './SettingsView.vue'

const UNCONFIGURED_VISION = {
  provider: 'claude' as const,
  enabled: false,
  configured: false,
  claude: { keyConfigured: false, configured: false, encrypted: true },
  openaiCompatible: {
    keyConfigured: false,
    configured: false,
    encrypted: true,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6-astra',
  },
}

const CLAUDE_CONFIGURED_VISION = {
  ...UNCONFIGURED_VISION,
  configured: true,
  claude: { keyConfigured: true, configured: true, encrypted: true },
}

vi.mock('@/api/config', () => ({
  fetchDiscordConfig: vi.fn().mockResolvedValue({ tokenConfigured: false }),
  fetchStoragePath: vi.fn().mockResolvedValue({ path: null }),
  fetchVisionConfig: vi.fn().mockResolvedValue({
    provider: 'claude',
    enabled: false,
    configured: false,
    claude: { keyConfigured: false, configured: false, encrypted: true },
    openaiCompatible: {
      keyConfigured: false,
      configured: false,
      encrypted: true,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-6-astra',
    },
  }),
  selectStorageFolder: vi.fn(),
  updateDiscordToken: vi.fn().mockResolvedValue({ tokenConfigured: true }),
  clearDiscordToken: vi.fn().mockResolvedValue({ tokenConfigured: false, encrypted: true }),
  LOCAL_TARGET_ID: 'local',
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

vi.mock('@/api/updates', () => ({
  fetchUpdateCheckSettings: vi.fn().mockResolvedValue({ enabled: true }),
  updateUpdateCheckEnabled: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/usage-stats', () => ({
  fetchUsageStats: vi.fn().mockResolvedValue({ enabled: false, prompted: false }),
  updateUsageStatsEnabled: vi.fn().mockResolvedValue({ enabled: true, prompted: false }),
}))

vi.mock('@/api/logs', () => ({
  fetchLogPath: vi.fn().mockResolvedValue('/data/logs/hibiki.log'),
  openLogFolder: vi.fn().mockResolvedValue(undefined),
  copyDiagnostics: vi.fn().mockResolvedValue({ lines: 330 }),
}))

vi.mock('@/api/hotkeys', () => ({
  fetchHotkeyStatus: vi.fn().mockResolvedValue({
    enabled: true,
    registered: [],
    failures: [
      { accelerator: 'F13', owner: 'Scene "Tavern"', reason: 'Global hotkeys are not supported under Wayland' },
    ],
  }),
}))

function mountSettings() {
  return mount(SettingsView, {
    global: {
      plugins: [
        createPinia(),
      ],
    },
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
      global: {
        plugins: [
          createPinia(),
        ],
      },
    })
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Settings')
  })

  it('renders Discord bot section', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [
          createPinia(),
        ],
      },
    })
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('Discord bot (optional)')
    expect(wrapper.text()).toContain('only needed to play into Discord')
    expect(wrapper.text()).toContain('No token — optional')
  })

  describe('discord token Remove', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('is only offered while a token is configured', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find('[data-testid="discord-token-remove"]').exists()).toBe(false)

      vi.mocked(fetchDiscordConfig).mockResolvedValueOnce({ tokenConfigured: true, encrypted: true })
      const withToken = mountSettings()
      await flushPromises()
      expect(withToken.find('[data-testid="discord-token-remove"]').exists()).toBe(true)

      vi.mocked(fetchDiscordConfig).mockResolvedValueOnce({ tokenConfigured: true, encrypted: true, fromEnvironment: true })
      const fromEnv = mountSettings()
      await flushPromises()
      expect(fromEnv.find('[data-testid="discord-token-remove"]').exists()).toBe(false)
      expect(fromEnv.text()).toContain('DISCORD_TOKEN environment variable')
    })

    it('does nothing when the confirmation is declined', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
      vi.mocked(fetchDiscordConfig).mockResolvedValueOnce({ tokenConfigured: true, encrypted: true })
      const wrapper = mountSettings()
      await flushPromises()
      await wrapper.find('[data-testid="discord-token-remove"]').trigger('click')
      await flushPromises()
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(clearDiscordToken).not.toHaveBeenCalled()
    })

    it('clears the token once confirmed and shows it is gone', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
      vi.mocked(fetchDiscordConfig).mockResolvedValueOnce({ tokenConfigured: true, encrypted: true })
      const pinia = createPinia()
      const wrapper = mount(SettingsView, {
        global: {
          plugins: [pinia],
        },
      })
      await flushPromises()
      const player = usePlayerStore(pinia)
      player.activeTarget = 'local'
      await wrapper.find('[data-testid="discord-token-remove"]').trigger('click')
      await flushPromises()
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(clearDiscordToken).toHaveBeenCalledTimes(1)
      expect(player.activeTarget).toBe('local')
      expect(wrapper.text()).toContain('Token removed.')
      expect(wrapper.text()).toContain('No token — optional')
      expect(wrapper.find('[data-testid="discord-token-remove"]').exists()).toBe(false)
    })
  })

  describe('discord connect', () => {
    it('shows why Connect failed when the login is rejected', async () => {
      vi.mocked(fetchDiscordConfig).mockResolvedValueOnce({ tokenConfigured: true, encrypted: true })
      const pinia = createPinia()
      const wrapper = mount(SettingsView, {
        global: {
          plugins: [pinia],
        },
      })
      await flushPromises()
      const player = usePlayerStore(pinia)
      vi.spyOn(player, 'doReconnect').mockRejectedValueOnce(new Error('An invalid token was provided.'))
      const connect = wrapper.findAll('button').find(b => b.text() === 'Connect')!
      await connect.trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Could not connect: An invalid token was provided.')
    })

    it('tells a saved token apart from a failed connect', async () => {
      const pinia = createPinia()
      const wrapper = mount(SettingsView, {
        global: {
          plugins: [pinia],
        },
      })
      await flushPromises()
      const player = usePlayerStore(pinia)
      vi.spyOn(player, 'doReconnect').mockRejectedValueOnce(new Error('An invalid token was provided.'))
      await wrapper.find('#token').setValue('bad-token')
      await wrapper.find('[data-testid="discord-token-save"]').trigger('click')
      await flushPromises()
      expect(updateDiscordToken).toHaveBeenCalledWith('bad-token')
      expect(wrapper.text()).toContain('Token saved, but the bot couldn\'t connect: An invalid token was provided.')
      expect(wrapper.text()).not.toContain('Couldn\'t save token')
    })
  })

  it('renders Storage location section', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [
          createPinia(),
        ],
      },
    })
    await flushPromises()
    const headings = wrapper.findAll('h2')
    expect(headings.some(h => h.text() === 'Storage location')).toBe(true)
  })

  describe('updates section', () => {
    it('shows the launch update check as on by default and saves turning it off', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      const toggle = wrapper.find<HTMLInputElement>('#update-check-enabled')
      expect(toggle.element.checked).toBe(true)
      await toggle.setValue(false)
      await flushPromises()
      expect(updateUpdateCheckEnabled).toHaveBeenCalledWith(false)
      expect(toggle.element.checked).toBe(false)
    })

    it('reflects a stored opt-out', async () => {
      vi.mocked(fetchUpdateCheckSettings).mockResolvedValueOnce({ enabled: false })
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find<HTMLInputElement>('#update-check-enabled').element.checked).toBe(false)
    })

    it('reverts the toggle and says so when saving fails', async () => {
      vi.mocked(updateUpdateCheckEnabled).mockRejectedValueOnce(new Error('disk full'))
      const wrapper = mountSettings()
      await flushPromises()
      const toggle = wrapper.find<HTMLInputElement>('#update-check-enabled')
      await toggle.setValue(false)
      await flushPromises()
      expect(toggle.element.checked).toBe(true)
      expect(wrapper.find('[data-testid="updates-section"]').text()).toContain('disk full')
    })
  })

  describe('usage stats section', () => {
    it('shows Usage Stats off by default and saves switching them on', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      const toggle = wrapper.find<HTMLInputElement>('#usage-stats-enabled')
      expect(toggle.element.checked).toBe(false)
      await toggle.setValue(true)
      await flushPromises()
      expect(updateUsageStatsEnabled).toHaveBeenCalledWith(true)
      expect(toggle.element.checked).toBe(true)
    })

    it('reflects a stored opt-in', async () => {
      vi.mocked(fetchUsageStats).mockResolvedValueOnce({ enabled: true, prompted: true })
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find<HTMLInputElement>('#usage-stats-enabled').element.checked).toBe(true)
    })

    it('reverts the toggle and says so when saving fails', async () => {
      vi.mocked(updateUsageStatsEnabled).mockRejectedValueOnce(new Error('disk full'))
      const wrapper = mountSettings()
      await flushPromises()
      const toggle = wrapper.find<HTMLInputElement>('#usage-stats-enabled')
      await toggle.setValue(true)
      await flushPromises()
      expect(toggle.element.checked).toBe(false)
      expect(wrapper.find('[data-testid="usage-stats-section"]').text()).toContain('disk full')
    })

    it('lists every event that is sent and links the privacy page', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      const items = wrapper.findAll('[data-testid="usage-stats-list"] li').map(li => li.text())
      expect(items).toHaveLength(7)
      expect(items.join('\n')).toContain('Scene played')
      expect(items.join('\n')).toContain('never the key')
      expect(wrapper.find('[data-testid="usage-stats-privacy-link"]').attributes('href')).toBe('https://phyberapex.github.io/hibiki/privacy')
    })
  })

  describe('diagnostics section', () => {
    it('copies the diagnostics summary and confirms it', async () => {
      const wrapper = mountSettings()
      await flushPromises()
      await wrapper.find('[data-testid="copy-diagnostics"]').trigger('click')
      await flushPromises()
      expect(copyDiagnostics).toHaveBeenCalledTimes(1)
      expect(wrapper.find('[data-testid="diagnostics-message"]').text()).toContain('copied to the clipboard')
    })

    it('says so when copying fails', async () => {
      vi.mocked(copyDiagnostics).mockRejectedValueOnce(new Error('clipboard busy'))
      const wrapper = mountSettings()
      await flushPromises()
      await wrapper.find('[data-testid="copy-diagnostics"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="diagnostics-message"]').text()).toContain('clipboard busy')
    })
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
      expect(labels).toEqual([
        'Stop Scene',
        'Stop all Effects',
        'Previous Scene',
        'Next Scene',
        'Volume Down',
        'Volume Up',
      ])
      const buttons = wrapper.findAll('[data-testid="hotkeys-section"] [data-testid="hotkey-recorder-button"]')
      await buttons[5].trigger('click')
      await buttons[5].trigger('keydown', { code: 'F14' })
      await flushPromises()
      expect(updateHotkeySettings).toHaveBeenCalledWith({ enabled: true, stopHotkey: 'F24', volumeUpHotkey: 'F14' })
    })

    it('restores the enable checkbox when saving it fails', async () => {
      vi.mocked(updateHotkeySettings).mockRejectedValueOnce(new Error('disk full'))
      const wrapper = mountSettings()
      await flushPromises()
      const toggle = wrapper.find<HTMLInputElement>('#hotkeys-enabled')
      await toggle.setValue(false)
      await flushPromises()
      expect(toggle.element.checked).toBe(true)
      expect(wrapper.find('[data-testid="hotkeys-section"]').text()).toContain('disk full')
    })

    it('refetches refused hotkeys when Settings is shown again', async () => {
      const showSettings = ref(true)
      const Host = defineComponent({
        setup: () => () => h(KeepAlive, null, [
          showSettings.value
            ? h(SettingsView)
            : h('div', 'Elsewhere'),
        ]),
      })
      const wrapper = mount(Host, {
        global: {
          plugins: [
            createPinia(),
          ],
        },
      })
      await flushPromises()
      expect(wrapper.find('[data-testid="hotkey-failures"]').text()).not.toContain('F15')

      showSettings.value = false
      await nextTick()
      vi.mocked(fetchHotkeyStatus).mockResolvedValueOnce({
        enabled: true,
        registered: [],
        failures: [
          { accelerator: 'F15', owner: 'Effect "Thunder"', reason: 'Already registered by another app' },
        ],
      })
      showSettings.value = true
      await flushPromises()
      expect(wrapper.find('[data-testid="hotkey-failures"]').text()).toContain('F15')
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
        global: {
          plugins: [
            createPinia(),
          ],
        },
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
        global: {
          plugins: [
            createPinia(),
          ],
        },
      })
      await flushPromises()
      expect(wrapper.find<HTMLInputElement>('#reduce-motion').element.checked).toBe(true)
    })

    it('persists turning luminance pulses off', async () => {
      stubMatchMedia(false)
      const { updateAccessibilitySettings } = await import('@/api/config')
      const wrapper = mount(SettingsView, {
        global: {
          plugins: [
            createPinia(),
          ],
        },
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
        global: {
          plugins: [pinia],
        },
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

    it('reverts the slider when saving the fade length fails', async () => {
      vi.mocked(updateSceneFadeLength).mockRejectedValueOnce(new Error('disk full'))
      const wrapper = mountSettings()
      await flushPromises()
      const slider = wrapper.find<HTMLInputElement>('#scene-fade-length')
      await slider.setValue('6')
      await flushPromises()
      expect(slider.element.value).toBe('3')
      expect(wrapper.find('.fade-value').text()).toBe('3s')
      expect(wrapper.text()).toContain('disk full')
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

    it('restores the toggle when switching the feature on fails', async () => {
      vi.mocked(fetchVisionConfig).mockResolvedValue(CLAUDE_CONFIGURED_VISION)
      vi.mocked(updateVisionEnabled).mockRejectedValueOnce(new Error('disk full'))
      const wrapper = mountSettings()
      await flushPromises()
      const toggle = wrapper.find<HTMLInputElement>('#vision-enabled')
      await toggle.setValue(true)
      await flushPromises()
      expect(toggle.element.checked).toBe(false)
      expect(wrapper.text()).toContain('disk full')
    })

    it('warns that the Claude key is stored as plain text when secrets are not encrypted', async () => {
      vi.mocked(fetchVisionConfig).mockResolvedValue({
        ...UNCONFIGURED_VISION,
        claude: { ...UNCONFIGURED_VISION.claude, encrypted: false },
      })
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find('[data-testid="vision-key-plaintext-warning"]').exists()).toBe(true)
    })

    it('warns that the OpenAI-compatible key is stored as plain text when secrets are not encrypted', async () => {
      vi.mocked(fetchVisionConfig).mockResolvedValue({
        ...UNCONFIGURED_VISION,
        provider: 'openai-compatible',
        claude: { ...UNCONFIGURED_VISION.claude, encrypted: false },
        openaiCompatible: { ...UNCONFIGURED_VISION.openaiCompatible, encrypted: false },
      })
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find('[data-testid="vision-key-plaintext-warning"]').exists()).toBe(true)
    })

    it('does not warn about plain text when the Vision keys are encrypted', async () => {
      vi.mocked(fetchVisionConfig).mockResolvedValue({ ...UNCONFIGURED_VISION, provider: 'openai-compatible' })
      const wrapper = mountSettings()
      await flushPromises()
      expect(wrapper.find('[data-testid="vision-key-plaintext-warning"]').exists()).toBe(false)
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

    it('restores the provider select when switching the Vision Provider fails', async () => {
      vi.mocked(updateVisionProvider).mockRejectedValueOnce(new Error('disk full'))
      const wrapper = mountSettings()
      await flushPromises()
      const select = wrapper.find<HTMLSelectElement>('#vision-provider')
      await select.setValue('openai-compatible')
      await flushPromises()
      expect(select.element.value).toBe('claude')
      expect(wrapper.find('#vision-base-url').exists()).toBe(false)
      expect(wrapper.text()).toContain('disk full')
    })

    it('saves a custom Base URL for the OpenAI-compatible provider', async () => {
      vi.mocked(fetchVisionConfig).mockResolvedValue({ ...UNCONFIGURED_VISION, provider: 'openai-compatible' })
      vi.mocked(updateVisionOpenAiBaseUrl).mockResolvedValue({
        ...UNCONFIGURED_VISION,
        provider: 'openai-compatible',
        configured: true,
        openaiCompatible: {
          keyConfigured: false,
          configured: true,
          encrypted: true,
          baseUrl: 'http://localhost:11434/v1',
          model: 'gpt-6-astra',
        },
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
        openaiCompatible: {
          keyConfigured: false,
          configured: false,
          encrypted: true,
          baseUrl: 'https://api.openai.com/v1',
          model: 'llava',
        },
      })
      vi.mocked(updateVisionOpenAiModel).mockResolvedValue({
        ...UNCONFIGURED_VISION,
        provider: 'openai-compatible',
        openaiCompatible: {
          keyConfigured: false,
          configured: false,
          encrypted: true,
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-6-astra',
        },
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
    stubDevices([
      { deviceId: 'a', label: 'USB Speaker' },
      { deviceId: 'b', label: '' },
      { deviceId: 'default', label: 'Default' },
    ])
    const wrapper = mountSettings()
    await flushPromises()
    expect(options(wrapper)).toEqual(['System default', 'USB Speaker', 'Output device 2'])
    expect(wrapper.text()).toContain('Browser tab always plays through the system default')
  })

  it('keeps an absent stored device selected as "(not connected)"', async () => {
    stubDevices([
      { deviceId: 'a', label: 'Built-in Output' },
    ])
    vi.mocked(fetchLocalOutputDevice).mockResolvedValueOnce({ deviceId: 'gone', label: 'USB Speaker' })
    const wrapper = mountSettings()
    await flushPromises()
    expect(options(wrapper)).toEqual(['System default', 'Built-in Output', 'USB Speaker (not connected)'])
    expect((wrapper.find('#output-device').element as HTMLSelectElement).value).toBe('gone')
  })

  it('saves the selection with its label, and clears it for System default', async () => {
    stubDevices([
      { deviceId: 'a', label: 'USB Speaker' },
    ])
    const wrapper = mountSettings()
    await flushPromises()
    await wrapper.find('#output-device').setValue('a')
    expect(updateLocalOutputDevice).toHaveBeenLastCalledWith({ deviceId: 'a', label: 'USB Speaker' })
    await wrapper.find('#output-device').setValue('')
    expect(updateLocalOutputDevice).toHaveBeenLastCalledWith(null)
  })

  it('keeps the stored selection when saving a new one fails', async () => {
    stubDevices([
      { deviceId: 'a', label: 'USB Speaker' },
    ])
    vi.mocked(updateLocalOutputDevice).mockRejectedValueOnce(new Error('disk full'))
    const wrapper = mountSettings()
    await flushPromises()
    await wrapper.find('#output-device').setValue('a')
    await flushPromises()
    expect((wrapper.find('#output-device').element as HTMLSelectElement).value).toBe('')
    expect(wrapper.text()).toContain('disk full')
  })

  it('re-lists devices on devicechange', async () => {
    const enumerate = stubDevices([
      { deviceId: 'a', label: 'USB Speaker' },
    ])
    const wrapper = mountSettings()
    await flushPromises()
    enumerate.mockResolvedValue([
      { kind: 'audiooutput', deviceId: 'a', label: 'USB Speaker' },
      { kind: 'audiooutput', deviceId: 'c', label: 'HDMI' },
    ] as never)
    handlers.forEach(h => h())
    await flushPromises()
    expect(options(wrapper)).toEqual(['System default', 'USB Speaker', 'HDMI'])
  })
})
