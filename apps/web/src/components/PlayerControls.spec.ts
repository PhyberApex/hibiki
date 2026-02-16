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
  setVolume: vi.fn().mockResolvedValue(undefined),
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

  it('selecting a channel triggers join and shows Joining then clears', async () => {
    const { joinChannel } = await import('@/api/player')
    let resolveJoin: () => void
    joinChannel.mockImplementation(() => new Promise<void>((r) => {
      resolveJoin = r
    }))
    const wrapper = mount(PlayerControls, {
      props: { playerState: [], soundsVersion: 0 },
    })
    await flushPromises()
    await wrapper.find('select.field-input').setValue('g1')
    await flushPromises()
    const channelSelect = wrapper.findAll('select.field-input')[1]
    await channelSelect.setValue('ch1')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.channel-joining').exists()).toBe(true)
    resolveJoin!()
    await flushPromises()
    expect(joinChannel).toHaveBeenCalledWith('g1', 'ch1')
    expect(wrapper.find('.channel-joining').exists()).toBe(false)
  })

  it('leave on success clears channel dropdown', async () => {
    const { leaveGuild } = await import('@/api/player')
    const wrapper = mount(PlayerControls, {
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
    await wrapper.find('select.field-input').setValue('g1')
    await flushPromises()
    expect(wrapper.find('.btn-leave').exists()).toBe(true)
    const channelSelect = wrapper.findAll('select.field-input')[1]
    expect(channelSelect.element.value).toBe('ch1')
    await wrapper.find('.btn-leave').trigger('click')
    await flushPromises()
    expect(leaveGuild).toHaveBeenCalledWith('g1')
    expect(channelSelect.element.value).toBe('')
  })

  it('shows error toast when leave fails', async () => {
    const { leaveGuild } = await import('@/api/player')
    leaveGuild.mockRejectedValueOnce(new Error('Network error'))
    const wrapper = mount(PlayerControls, {
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
    await wrapper.find('select.field-input').setValue('g1')
    await flushPromises()
    await wrapper.find('.btn-leave').trigger('click')
    await flushPromises()
    expect(wrapper.find('.toast-error').exists()).toBe(true)
    expect(wrapper.find('.toast').text()).toContain('Network error')
  })

  it('reload guilds shows error when fetch fails', async () => {
    const { fetchGuildDirectory } = await import('@/api/player')
    fetchGuildDirectory
      .mockResolvedValueOnce([{ guildId: 'g1', guildName: 'Test Guild', channels: [{ id: 'ch1', name: 'General' }] }])
      .mockRejectedValueOnce(new Error('Failed to load'))
    const wrapper = mount(PlayerControls, {
      props: { playerState: [], soundsVersion: 0 },
    })
    await flushPromises()
    expect(wrapper.find('.control-error').exists()).toBe(false)
    await wrapper.find('.btn-ghost').trigger('click')
    await flushPromises()
    expect(wrapper.find('.control-error').exists()).toBe(true)
    expect(wrapper.find('.control-error').text()).toContain('Failed to load')
  })

  it('volume sliders call setVolume and emit actionDone', async () => {
    const { setVolume } = await import('@/api/player')
    const wrapper = mount(PlayerControls, {
      props: {
        playerState: [
          {
            guildId: 'g1',
            connectedChannelId: 'ch1',
            connectedChannelName: 'General',
            isIdle: true,
            track: null,
            source: 'live',
            volume: { music: 50, effects: 60 },
          },
        ],
        soundsVersion: 0,
      },
    })
    await flushPromises()
    await wrapper.find('select.field-input').setValue('g1')
    await flushPromises()
    const musicSlider = wrapper.findAll('input.volume-slider')[0]
    await musicSlider.setValue(75)
    musicSlider.trigger('change')
    await flushPromises()
    expect(setVolume).toHaveBeenCalledWith({ guildId: 'g1', music: 75 })
    expect(wrapper.emitted('actionDone')).toBeTruthy()
  })

  it('volume change failure shows error toast', async () => {
    const { setVolume } = await import('@/api/player')
    setVolume.mockRejectedValueOnce(new Error('Set volume failed'))
    const wrapper = mount(PlayerControls, {
      props: {
        playerState: [
          {
            guildId: 'g1',
            connectedChannelId: 'ch1',
            isIdle: true,
            track: null,
            source: 'live',
            volume: { music: 50, effects: 60 },
          },
        ],
        soundsVersion: 0,
      },
    })
    await flushPromises()
    await wrapper.find('select.field-input').setValue('g1')
    await flushPromises()
    const musicSlider = wrapper.findAll('input.volume-slider')[0]
    await musicSlider.setValue(80)
    musicSlider.trigger('change')
    await flushPromises()
    expect(wrapper.find('.toast-error').exists()).toBe(true)
    expect(wrapper.find('.toast').text()).toContain('Set volume failed')
  })
})
