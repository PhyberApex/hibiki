import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import { usePlayerStore } from './stores/player'
import AboutView from './views/AboutView.vue'
import MediaManagementView from './views/MediaManagementView.vue'

vi.mock('@/api/config', () => ({
  fetchAccessibilitySettings: vi.fn().mockResolvedValue({ luminancePulses: true, reduceMotion: null }),
  updateAccessibilitySettings: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/player', () => ({
  fetchPlayerState: vi.fn().mockResolvedValue([]),
  fetchBotStatus: vi.fn().mockResolvedValue({ ready: true, userTag: 'Bot#0' }),
  fetchGuildDirectory: vi.fn().mockResolvedValue([]),
  joinChannel: vi.fn().mockResolvedValue(undefined),
  leaveGuild: vi.fn().mockResolvedValue(undefined),
  reconnectBot: vi.fn().mockResolvedValue(undefined),
}))

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/scenes' },
    { path: '/media', name: 'media', component: MediaManagementView },
    { path: '/scenes', name: 'scenes', component: () => Promise.resolve({ template: '<div>Scenes</div>' }) },
    { path: '/scenes/:id', name: 'scene', component: () => Promise.resolve({ template: '<div>Scene</div>' }) },
    { path: '/browser', name: 'browser', component: () => Promise.resolve({ template: '<div>Browser</div>' }) },
    { path: '/settings', name: 'settings', component: () => Promise.resolve({ template: '<div>Settings</div>' }) },
    { path: '/about', name: 'about', component: AboutView },
  ],
})

describe('app', () => {
  it('renders layout with sidebar and content', async () => {
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    expect(wrapper.find('.layout').exists()).toBe(true)
    expect(wrapper.find('.sidebar').exists()).toBe(true)
    expect(wrapper.find('.content').exists()).toBe(true)
  })

  it('shows brand title', async () => {
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    expect(wrapper.find('.brand-title').text()).toBe('Hibiki')
  })

  it('has tab links to Media, Scenes, Browser, and Settings', async () => {
    await router.push('/media')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    const tabs = wrapper.findAll('.sidebar-tab')
    expect(tabs).toHaveLength(4)
    expect(tabs[0]!.text()).toBe('Media')
    expect(tabs[1]!.text()).toBe('Scenes')
    expect(tabs[2]!.text()).toBe('Browser')
    expect(tabs[3]!.text()).toBe('Settings')
    expect(tabs[0]!.attributes('href')).toBe('/media')
    expect(tabs[1]!.attributes('href')).toBe('/scenes')
    expect(tabs[2]!.attributes('href')).toBe('/browser')
    expect(tabs[3]!.attributes('href')).toBe('/settings')
  })

  it('renders RouterView in content area', async () => {
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    expect(wrapper.findComponent({ name: 'RouterView' }).exists()).toBe(true)
  })

  it('shows app version in footer', async () => {
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    const versionEl = wrapper.find('.version')
    expect(versionEl.exists()).toBe(true)
    expect(versionEl.text()).toMatch(/^v\d/)
  })

  it('isTabActive matches scenes sub-routes', async () => {
    await router.push('/scenes/123')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    const scenesTab = wrapper.findAll('.sidebar-tab').find(t => t.text().includes('Scenes'))
    expect(scenesTab?.classes()).toContain('sidebar-tab-active')
  })

  it('renders guild directory when available', async () => {
    const { fetchBotStatus, fetchGuildDirectory } = await import('@/api/player')
    vi.mocked(fetchBotStatus).mockResolvedValue({ ready: true, userTag: 'Bot#0' })
    vi.mocked(fetchGuildDirectory).mockResolvedValue([
      {
        guildId: 'g1',
        guildName: 'Test Guild',
        iconUrl: null,
        channels: [{ id: 'ch1', name: 'General' }],
      },
    ])
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    await flushPromises()
    expect(wrapper.find('.guild-name').text()).toBe('Test Guild')
    expect(wrapper.find('.channel-item').text()).toContain('General')
  })

  it('shows disconnect button when connected', async () => {
    const { fetchPlayerState, fetchBotStatus, fetchGuildDirectory } = await import('@/api/player')
    vi.mocked(fetchPlayerState).mockResolvedValue([
      { guildId: 'g1', connectedChannelId: 'ch1', isIdle: true, track: null, source: 'live' as const },
    ])
    vi.mocked(fetchBotStatus).mockResolvedValue({ ready: true, userTag: 'Bot#0' })
    vi.mocked(fetchGuildDirectory).mockResolvedValue([
      {
        guildId: 'g1',
        guildName: 'Test Guild',
        iconUrl: null,
        channels: [{ id: 'ch1', name: 'General' }],
      },
    ])
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    await flushPromises()
    expect(wrapper.find('.btn-disconnect').exists()).toBe(true)
    expect(wrapper.find('.btn-disconnect').text()).toBe('Leave voice')
    expect(wrapper.find('.btn-disconnect').attributes('title')).toContain('Test Guild')
  })

  it('renders welcome layout for root path', async () => {
    const welcomeRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'welcome', component: () => Promise.resolve({ template: '<div>Welcome</div>' }) },
        { path: '/scenes', name: 'scenes', component: () => Promise.resolve({ template: '<div>Scenes</div>' }) },
      ],
    })
    await welcomeRouter.push('/')
    await welcomeRouter.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), welcomeRouter],
      },
    })
    expect(wrapper.find('.welcome-layout').exists()).toBe(true)
    expect(wrapper.find('.layout').exists()).toBe(false)
  })

  it('shows Disconnected when bot is not ready', async () => {
    const { fetchBotStatus } = await import('@/api/player')
    vi.mocked(fetchBotStatus).mockResolvedValue({ ready: false })
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    await flushPromises()
    expect(wrapper.find('.bot-status').text()).toContain('Disconnected')
  })

  it('loads accessibility settings on mount', async () => {
    const { fetchAccessibilitySettings } = await import('@/api/config')
    vi.mocked(fetchAccessibilitySettings).mockClear()
    await router.push('/scenes')
    await router.isReady()
    mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    await flushPromises()
    expect(fetchAccessibilitySettings).toHaveBeenCalled()
  })

  it('pulses the bot status sharply while disconnected', async () => {
    const { fetchBotStatus } = await import('@/api/player')
    vi.mocked(fetchBotStatus).mockResolvedValue({ ready: false })
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    await flushPromises()
    const status = wrapper.find('.bot-status')
    expect(status.classes()).toContain('pulse')
    expect(status.classes()).toContain('pulse-alert')
    expect(status.classes()).not.toContain('pulse-steady')
  })

  it('shows a steady glow on the bot status while connected', async () => {
    const { fetchBotStatus } = await import('@/api/player')
    vi.mocked(fetchBotStatus).mockResolvedValue({ ready: true, userTag: 'Bot#0' })
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    await flushPromises()
    const status = wrapper.find('.bot-status')
    expect(status.classes()).toContain('pulse-steady')
    expect(status.classes()).not.toContain('pulse-alert')
  })

  it('pulses the bot status at a busy rate while reconnecting', async () => {
    const { fetchBotStatus, reconnectBot } = await import('@/api/player')
    vi.mocked(fetchBotStatus).mockResolvedValue({ ready: false })
    let releaseReconnect: () => void = () => {}
    vi.mocked(reconnectBot).mockReturnValue(new Promise<void>((resolve) => {
      releaseReconnect = resolve
    }))
    await router.push('/scenes')
    await router.isReady()
    const pinia = createPinia()
    const wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
      },
    })
    await flushPromises()
    const player = usePlayerStore(pinia)
    const reconnecting = player.doReconnect()
    await flushPromises()
    expect(wrapper.find('.bot-status').classes()).toContain('pulse-busy')
    vi.mocked(fetchBotStatus).mockResolvedValue({ ready: true, userTag: 'Bot#0' })
    releaseReconnect()
    await reconnecting
    await flushPromises()
    expect(wrapper.find('.bot-status').classes()).toContain('pulse-steady')
  })

  it('glows the connected channel dot and pulses a channel while joining', async () => {
    const { fetchPlayerState, fetchBotStatus, fetchGuildDirectory, joinChannel } = await import('@/api/player')
    vi.mocked(fetchPlayerState).mockResolvedValue([
      { guildId: 'g1', connectedChannelId: 'ch1', isIdle: true, track: null, source: 'live' as const },
    ])
    vi.mocked(fetchBotStatus).mockResolvedValue({ ready: true, userTag: 'Bot#0' })
    vi.mocked(fetchGuildDirectory).mockResolvedValue([
      {
        guildId: 'g1',
        guildName: 'Test Guild',
        iconUrl: null,
        channels: [{ id: 'ch1', name: 'General' }, { id: 'ch2', name: 'Tavern' }],
      },
    ])
    let releaseJoin: () => void = () => {}
    vi.mocked(joinChannel).mockReturnValue(new Promise<void>((resolve) => {
      releaseJoin = resolve
    }))
    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    })
    await flushPromises()
    const dots = wrapper.findAll('.channel-dot')
    expect(dots[0]!.classes()).toContain('pulse-steady')
    expect(dots[1]!.classes()).not.toContain('pulse')

    await wrapper.findAll('.channel-item')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.channel-dot')[1]!.classes()).toContain('pulse-busy')
    releaseJoin()
    await flushPromises()
    expect(wrapper.findAll('.channel-dot')[1]!.classes()).not.toContain('pulse-busy')
  })
})
