import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import AboutView from './views/AboutView.vue'
import MediaManagementView from './views/MediaManagementView.vue'

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
    expect(wrapper.find('.btn-disconnect').text()).toContain('Test Guild')
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
})
