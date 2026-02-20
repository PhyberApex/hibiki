import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlayerControls from '@/components/PlayerControls.vue'
import SoundList from '@/components/SoundList.vue'
import HomeView from './HomeView.vue'

vi.mock('@/api/player', () => ({
  fetchPlayerState: vi.fn().mockResolvedValue([]),
  fetchBotStatus: vi.fn().mockResolvedValue({ ready: true, userTag: 'Bot#0' }),
  fetchGuildDirectory: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([]),
}))

describe('homeView', () => {
  it('renders Control Center heading', async () => {
    const wrapper = mount(HomeView)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('h1').text()).toBe('Control Center')
  })

  it('renders Player state section', () => {
    const wrapper = mount(HomeView)
    expect(wrapper.find('h2').text()).toBe('Player state')
  })

  it('renders SoundList for Music and Effects', () => {
    const wrapper = mount(HomeView)
    const soundLists = wrapper.findAllComponents(SoundList)
    expect(soundLists.length).toBe(2)
  })

  it('renders PlayerControls', () => {
    const wrapper = mount(HomeView)
    expect(wrapper.findComponent(PlayerControls).exists()).toBe(true)
  })

  it('shows error message when loadState fails', async () => {
    const { fetchPlayerState } = await import('@/api/player')
    vi.mocked(fetchPlayerState).mockRejectedValue(new Error('API error'))
    const wrapper = mount(HomeView)
    await flushPromises()
    expect(wrapper.find('.panel-error').exists()).toBe(true)
    expect(wrapper.text()).toContain('API error')
  })

  it('shows bot disconnected when fetchBotStatus fails', async () => {
    const { fetchPlayerState, fetchBotStatus } = await import('@/api/player')
    vi.mocked(fetchPlayerState).mockResolvedValue([])
    vi.mocked(fetchBotStatus).mockRejectedValue(new Error('Network error'))
    const wrapper = mount(HomeView)
    await flushPromises()
    expect(wrapper.find('.bot-status-disconnected').exists()).toBe(true)
    expect(wrapper.text()).toContain('Bot disconnected')
  })

  it('shows guild state when state has items', async () => {
    const { fetchPlayerState } = await import('@/api/player')
    vi.mocked(fetchPlayerState).mockResolvedValue([
      {
        guildId: 'g1',
        connectedChannelName: 'General',
        isIdle: true,
        track: null,
        source: 'live',
        lastUpdated: new Date().toISOString(),
      },
    ])
    const wrapper = mount(HomeView)
    await flushPromises()
    expect(wrapper.find('.state-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('g1')
    expect(wrapper.text()).toContain('General')
  })

  it('shows No guilds connected when state is empty', async () => {
    const { fetchPlayerState } = await import('@/api/player')
    vi.mocked(fetchPlayerState).mockResolvedValue([])
    const wrapper = mount(HomeView)
    await flushPromises()
    expect(wrapper.text()).toContain('No guilds connected')
  })
})
