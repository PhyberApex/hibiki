import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PlayerControls from './PlayerControls.vue'

vi.mock('@/api/player', () => ({
  fetchGuildDirectory: vi.fn().mockResolvedValue([
    { guildId: 'g1', guildName: 'Test Guild', channels: [{ id: 'ch1', name: 'General' }] },
  ]),
  joinChannel: vi.fn().mockResolvedValue({}),
  leaveGuild: vi.fn().mockResolvedValue({}),
  stopPlayback: vi.fn().mockResolvedValue({}),
  playTrack: vi.fn().mockResolvedValue({}),
  triggerEffect: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([{ id: 't1', name: 'Track 1', filename: 't1.mp3', category: 'music' }]),
  listEffects: vi.fn().mockResolvedValue([{ id: 'e1', name: 'Effect 1', filename: 'e1.wav', category: 'effects' }]),
}))

describe('PlayerControls', () => {
  it('renders playback controls header', () => {
    const wrapper = mount(PlayerControls, {
      props: { playerState: [], soundsVersion: 0 },
    })
    expect(wrapper.find('h2').text()).toBe('Playback controls')
    expect(wrapper.find('.eyebrow').text()).toBe('Actions')
  })

  it('has Join, Leave, Stop, Play, Effect buttons', async () => {
    const wrapper = mount(PlayerControls, {
      props: { playerState: [], soundsVersion: 0 },
    })
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('.btn')
    const texts = buttons.map((b) => b.text())
    expect(texts).toContain('Join')
    expect(texts).toContain('Leave')
    expect(texts).toContain('Stop')
    expect(texts).toContain('Play')
    expect(texts).toContain('Effect')
  })

  it('has Reload guilds button', () => {
    const wrapper = mount(PlayerControls, {
      props: { playerState: [], soundsVersion: 0 },
    })
    expect(wrapper.find('.btn-ghost').text()).toMatch(/Reload guilds/)
  })

  it('shows guild and channel selects after directory load', async () => {
    const wrapper = mount(PlayerControls, {
      props: { playerState: [], soundsVersion: 0 },
    })
    await flushPromises()
    const selects = wrapper.findAll('select.field-input')
    expect(selects.length).toBeGreaterThanOrEqual(1)
  })
})
