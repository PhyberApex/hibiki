import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlayerControls from '@/components/PlayerControls.vue'
import SoundList from '@/components/SoundList.vue'
import HomeView from './HomeView.vue'

vi.mock('@/api/player', () => ({
  fetchPlayerState: vi.fn().mockResolvedValue([]),
  fetchBotStatus: vi.fn().mockResolvedValue({ ready: true, userTag: 'Bot#0' }),
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
})
