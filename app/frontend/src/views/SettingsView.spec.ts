import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import SettingsView from './SettingsView.vue'

vi.mock('@/api/config', () => ({
  fetchDiscordConfig: vi.fn().mockResolvedValue({ tokenConfigured: false }),
  fetchStoragePath: vi.fn().mockResolvedValue({ path: null }),
  selectStorageFolder: vi.fn(),
  updateDiscordToken: vi.fn().mockResolvedValue({ tokenConfigured: true }),
  updateStoragePath: vi.fn().mockResolvedValue(undefined),
}))

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
})
