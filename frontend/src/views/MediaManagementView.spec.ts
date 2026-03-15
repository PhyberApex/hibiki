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
    expect(wrapper.find('h1').text()).toBe('Media Library')
  })

  it('renders SoundListManage for Music, Ambience, and Effects', () => {
    const wrapper = mount(MediaManagementView, {
      global: { plugins: [createPinia(), router] },
    })
    const lists = wrapper.findAllComponents(SoundListManage)
    expect(lists).toHaveLength(3)
    expect(lists[0]!.props('title')).toBe('Music')
    expect(lists[0]!.props('type')).toBe('music')
    expect(lists[1]!.props('title')).toBe('Ambience')
    expect(lists[1]!.props('type')).toBe('ambience')
    expect(lists[2]!.props('title')).toBe('Effects')
    expect(lists[2]!.props('type')).toBe('effects')
  })
})
