import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccessibilityStore } from '@/stores/accessibility'
import SettingsView from './SettingsView.vue'

vi.mock('@/api/config', () => ({
  fetchDiscordConfig: vi.fn().mockResolvedValue({ tokenConfigured: false }),
  fetchStoragePath: vi.fn().mockResolvedValue({ path: null }),
  selectStorageFolder: vi.fn(),
  updateDiscordToken: vi.fn().mockResolvedValue({ tokenConfigured: true }),
  updateStoragePath: vi.fn().mockResolvedValue(undefined),
  fetchAccessibilitySettings: vi.fn().mockResolvedValue({ luminancePulses: true, reduceMotion: null }),
  updateAccessibilitySettings: vi.fn().mockResolvedValue(undefined),
}))

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
})
