import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import AboutView from './views/AboutView.vue'
import HomeView from './views/HomeView.vue'
import MediaManagementView from './views/MediaManagementView.vue'
import PermissionsView from './views/PermissionsView.vue'

vi.mock('@/api/player', () => ({
  fetchPlayerState: vi.fn().mockResolvedValue([]),
  fetchBotStatus: vi.fn().mockResolvedValue({ ready: true, userTag: 'Bot#0' }),
}))
vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/api/permissions', () => ({
  fetchPermissionsConfig: vi.fn().mockResolvedValue({ allowedDiscordRoleIds: [], allowedDiscordUserIds: [] }),
  updatePermissionsConfig: vi.fn().mockResolvedValue({}),
}))

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/media', name: 'media', component: MediaManagementView },
    { path: '/permissions', name: 'permissions', component: PermissionsView },
    { path: '/about', name: 'about', component: AboutView },
  ],
})

describe('app', () => {
  it('renders layout with sidebar and content', async () => {
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    })
    expect(wrapper.find('.layout').exists()).toBe(true)
    expect(wrapper.find('.sidebar').exists()).toBe(true)
    expect(wrapper.find('.content').exists()).toBe(true)
  })

  it('shows brand title and subtitle', async () => {
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    })
    expect(wrapper.find('.brand-title').text()).toBe('Hibiki')
    expect(wrapper.find('.brand-subtitle').text()).toBe('Echoes of Adventure')
  })

  it('has nav links to Control center, Media management, and Permissions', async () => {
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    })
    const links = wrapper.findAll('.nav-link')
    expect(links).toHaveLength(3)
    expect(links[0]!.text()).toBe('Control center')
    expect(links[1]!.text()).toBe('Media management')
    expect(links[2]!.text()).toBe('Permissions')
    expect(links[0]!.attributes('href')).toBe('/')
    expect(links[1]!.attributes('href')).toBe('/media')
    expect(links[2]!.attributes('href')).toBe('/permissions')
  })

  it('renders RouterView in content area', async () => {
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    })
    expect(wrapper.findComponent({ name: 'RouterView' }).exists()).toBe(true)
  })

  it('shows app version in sidebar', async () => {
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    })
    const versionEl = wrapper.find('.version')
    expect(versionEl.exists()).toBe(true)
    expect(versionEl.text()).toMatch(/^v\d/)
  })
})
