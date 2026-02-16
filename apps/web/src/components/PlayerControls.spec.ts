import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
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

describe('playerControls', () => {
  it('renders playback controls header', () => {
    const wrapper = mount(PlayerControls, {
      props: { playerState: [], soundsVersion: 0 },
    })
    expect(wrapper.find('h2').text()).toBe('Playback controls')
    expect(wrapper.find('.eyebrow').text()).toBe('Actions')
  })

  it('has Stop, Play, and Play effect buttons (no Join; Leave only when connected)', async () => {
    const wrapper = mount(PlayerControls, {
      props: { playerState: [], soundsVersion: 0 },
    })
    await flushPromises()
    const buttons = wrapper.findAll('.btn')
    const texts = buttons.map(b => b.text())
    expect(texts).not.toContain('Join')
    expect(texts).toContain('Stop')
    expect(texts).toContain('Play')
    expect(texts).toContain('Play effect')
    // Leave is only shown when connected to a channel (isJoined)
    const wrapperConnected = mount(PlayerControls, {
      props: {
        playerState: [
          {
            guildId: 'g1',
            connectedChannelId: 'ch1',
            connectedChannelName: 'General',
            isIdle: true,
            track: null,
            source: 'live',
            volume: { music: 80, effects: 80 },
          },
        ],
        soundsVersion: 0,
      },
    })
    await flushPromises()
    await wrapperConnected.find('select.field-input').setValue('g1')
    await flushPromises()
    expect(wrapperConnected.find('.btn-leave').exists()).toBe(true)
    expect(wrapperConnected.find('.btn-leave').text()).toBe('Leave')
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
