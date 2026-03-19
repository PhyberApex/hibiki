import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import SoundListManage from '@/components/SoundListManage.vue'
import MediaManagementView from './MediaManagementView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '' } }],
})

vi.mock('@/api/config', () => ({
  fetchDiscordConfig: vi.fn().mockResolvedValue({ tokenConfigured: false }),
}))

vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([]),
  listAmbience: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([]),
  uploadSound: vi.fn().mockResolvedValue({}),
  uploadSoundsBulk: vi.fn().mockResolvedValue({ success: [], failed: [] }),
  deleteSound: vi.fn().mockResolvedValue(undefined),
  soundStreamUrl: (type: string, id: string) => `/api/sounds/${type}/${id}/file`,
}))

vi.mock('@/api/player', () => ({
  fetchPlayerState: vi.fn().mockResolvedValue([]),
  fetchBotStatus: vi.fn().mockResolvedValue({ ready: false }),
  fetchGuildDirectory: vi.fn().mockResolvedValue([]),
  joinChannel: vi.fn(),
  leaveGuild: vi.fn(),
  reconnectBot: vi.fn(),
}))

describe('mediaManagementView', () => {
  it('renders page title', () => {
    const wrapper = mount(MediaManagementView, {
      global: { plugins: [createPinia(), router] },
    })
    expect(wrapper.find('h1').text()).toBe('Sound library')
  })

  it('renders category tabs and defaults to Music', () => {
    const wrapper = mount(MediaManagementView, {
      global: { plugins: [createPinia(), router] },
    })
    const tabs = wrapper.findAll('.category-tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]!.text()).toContain('Music')
    expect(tabs[1]!.text()).toContain('Ambience')
    expect(tabs[2]!.text()).toContain('Effects')

    // Default tab renders Music SoundListManage
    const list = wrapper.findComponent(SoundListManage)
    expect(list.exists()).toBe(true)
    expect(list.props('type')).toBe('music')
  })

  it('switches tab to show different SoundListManage', async () => {
    const wrapper = mount(MediaManagementView, {
      global: { plugins: [createPinia(), router] },
    })
    const tabs = wrapper.findAll('.category-tab')

    await tabs[1]!.trigger('click')
    const list = wrapper.findComponent(SoundListManage)
    expect(list.props('type')).toBe('ambience')
  })
})
