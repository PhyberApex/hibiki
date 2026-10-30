import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { fetchDiscordConfig } from '@/api/config'
import SoundListManage from '@/components/SoundListManage.vue'
import { usePlayerStore } from '@/stores/player'
import MediaManagementView from './MediaManagementView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: { template: '' },
    },
  ],
})

vi.mock('@/api/config', () => ({
  LOCAL_TARGET_ID: 'local',
  fetchDiscordConfig: vi.fn().mockResolvedValue({ tokenConfigured: false }),
}))

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
  onPlayerStateChanged: vi.fn().mockReturnValue(() => {}),
}))

describe('mediaManagementView', () => {
  it('renders page title', () => {
    const wrapper = mount(MediaManagementView, {
      global: {
        plugins: [
          createPinia(),
          router,
        ],
      },
    })
    expect(wrapper.find('h1').text()).toBe('Sound library')
  })

  it('renders category tabs and defaults to Music', () => {
    const wrapper = mount(MediaManagementView, {
      global: {
        plugins: [
          createPinia(),
          router,
        ],
      },
    })
    const tabs = wrapper.findAll('.category-tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]!.text()).toContain('Music')
    expect(tabs[1]!.text()).toContain('Ambience')
    expect(tabs[2]!.text()).toContain('Effects')

    // Default tab renders Music SoundListManage
    const list = wrapper.findComponent(SoundListManage)
    expect(list.exists()).toBe(true)
    expect(list.props('type')).toBe('music')
  })

  it('switches tab to show different SoundListManage', async () => {
    const wrapper = mount(MediaManagementView, {
      global: {
        plugins: [
          createPinia(),
          router,
        ],
      },
    })
    const tabs = wrapper.findAll('.category-tab')

    await tabs[1]!.trigger('click')
    const list = wrapper.findComponent(SoundListManage)
    expect(list.props('type')).toBe('ambience')
  })
})

describe('mediaManagementView local target', () => {
  it('shows no Discord setup or connecting guidance while Local is active', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    usePlayerStore().activeTarget = 'local'
    const wrapper = mount(MediaManagementView, {
      global: {
        plugins: [pinia, router],
      },
    })
    await flushPromises()
    expect(wrapper.find('.setup-guide').exists()).toBe(false)
  })
})

describe('mediaManagementView under KeepAlive', () => {
  it('drops the token step of the setup guide once a token was saved elsewhere', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    usePlayerStore().activeTarget = 'discord'
    const showMedia = ref(true)
    const Host = defineComponent({
      setup: () => () => h(KeepAlive, null, [
        showMedia.value
          ? h(MediaManagementView)
          : h('div', 'Settings'),
      ]),
    })
    const wrapper = mount(Host, {
      global: {
        plugins: [pinia, router],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Add your Discord bot token')

    showMedia.value = false
    await nextTick()
    vi.mocked(fetchDiscordConfig).mockResolvedValueOnce({ tokenConfigured: true, encrypted: true })
    showMedia.value = true
    await flushPromises()
    expect(wrapper.text()).not.toContain('Add your Discord bot token')
    expect(wrapper.text()).toContain('Token saved, not connected')
  })
})

describe('mediaManagementView with a saved token', () => {
  function mountWithToken() {
    vi.mocked(fetchDiscordConfig).mockResolvedValue({ tokenConfigured: true, encrypted: true })
    const pinia = createPinia()
    setActivePinia(pinia)
    const player = usePlayerStore()
    player.activeTarget = 'discord'
    const wrapper = mount(MediaManagementView, {
      global: {
        plugins: [pinia, router],
      },
    })
    return { wrapper, player }
  }

  afterEach(() => {
    vi.mocked(fetchDiscordConfig).mockResolvedValue({ tokenConfigured: false, encrypted: true })
  })

  it('points to Settings instead of connecting forever when the bot is not ready and not reconnecting', async () => {
    const { wrapper } = mountWithToken()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Connecting to Discord')
    expect(wrapper.find('[data-testid="setup-token-not-connected"]').text().replace(/\s+/g, ' ')).toBe('Token saved, not connected. Check Settings')
    expect(wrapper.text()).not.toContain('Add your Discord bot token')
  })

  it('shows the connecting banner only while a reconnect runs', async () => {
    const { wrapper, player } = mountWithToken()
    await flushPromises()
    player.reconnecting = true
    await nextTick()
    expect(wrapper.text()).toContain('Connecting to Discord')
    expect(wrapper.find('[data-testid="setup-token-not-connected"]').exists()).toBe(false)
  })

  it('shows no guidance once the bot is ready', async () => {
    const { wrapper, player } = mountWithToken()
    await flushPromises()
    player.botStatus = { ready: true }
    await nextTick()
    expect(wrapper.find('.setup-guide').exists()).toBe(false)
  })
})
