import { mount } from '@vue/test-utils'
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
})
