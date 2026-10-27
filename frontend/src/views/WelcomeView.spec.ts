import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDiscordConfig, updateActiveOutputTarget } from '@/api/config'
import { fetchUsageStats, markUsageStatsPrompted, updateUsageStatsEnabled } from '@/api/usage-stats'
import { logInfo } from '@/audio/audio-element-diagnostics'
import { usePlayerStore } from '@/stores/player'
import WelcomeView from './WelcomeView.vue'

const replace = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace }),
}))
vi.mock('@/api/config', () => ({
  LOCAL_TARGET_ID: 'local',
  fetchActiveOutputTarget: vi.fn().mockResolvedValue('local'),
  updateActiveOutputTarget: vi.fn().mockResolvedValue(undefined),
  fetchDiscordConfig: vi.fn().mockResolvedValue({ tokenConfigured: false }),
}))
vi.mock('@/api/player', () => ({
  fetchPlayerState: vi.fn(),
  fetchBotStatus: vi.fn(),
  fetchGuildDirectory: vi.fn(),
  joinChannel: vi.fn(),
  leaveGuild: vi.fn(),
  onPlayerStateChanged: vi.fn().mockReturnValue(() => {}),
  reconnectBot: vi.fn(),
  stopEffect: vi.fn(),
}))
vi.mock('@/audio/audio-element-diagnostics', () => ({
  logInfo: vi.fn(),
}))
vi.mock('@/api/usage-stats', () => ({
  fetchUsageStats: vi.fn(),
  markUsageStatsPrompted: vi.fn(),
  updateUsageStatsEnabled: vi.fn(),
}))

function mountWelcome() {
  return mount(WelcomeView)
}

describe('welcomeView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(fetchDiscordConfig).mockResolvedValue({ tokenConfigured: false } as never)
    vi.mocked(fetchUsageStats).mockResolvedValue({ enabled: false, prompted: true })
    vi.mocked(markUsageStatsPrompted).mockResolvedValue({ enabled: false, prompted: true })
    vi.mocked(updateUsageStatsEnabled).mockResolvedValue({ enabled: true, prompted: true })
  })

  it('offers both paths', () => {
    const text = mountWelcome().text()
    expect(text).toContain('Play at the table')
    expect(text).toContain('Play in Discord')
  })

  it('local path sets the Local Target and goes to Scenes without a token', async () => {
    const wrapper = mountWelcome()
    await wrapper.find('.btn-path-local').trigger('click')
    await flushPromises()
    expect(updateActiveOutputTarget).toHaveBeenCalledWith('local')
    expect(usePlayerStore().activeTarget).toBe('local')
    expect(replace).toHaveBeenCalledWith('/scenes')
    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('local'))
  })

  it('discord path without a token goes to Settings', async () => {
    const wrapper = mountWelcome()
    await wrapper.find('.btn-path-discord').trigger('click')
    await flushPromises()
    expect(updateActiveOutputTarget).toHaveBeenCalledWith('discord')
    expect(replace).toHaveBeenCalledWith('/settings')
    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('discord'))
  })

  it('discord path with a token goes to Scenes', async () => {
    vi.mocked(fetchDiscordConfig).mockResolvedValue({ tokenConfigured: true } as never)
    const wrapper = mountWelcome()
    await wrapper.find('.btn-path-discord').trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/scenes')
  })

  describe('usage stats invitation', () => {
    it('is not shown once answered', async () => {
      const wrapper = mountWelcome()
      await flushPromises()
      expect(wrapper.find('[data-testid="usage-stats-card"]').exists()).toBe(false)
    })

    it('is not shown when the settings cannot be read', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(fetchUsageStats).mockRejectedValue(new Error('gone'))
      const wrapper = mountWelcome()
      await flushPromises()
      expect(wrapper.find('[data-testid="usage-stats-card"]').exists()).toBe(false)
    })

    it('enable marks the invitation answered and switches Usage Stats on', async () => {
      vi.mocked(fetchUsageStats).mockResolvedValue({ enabled: false, prompted: false })
      const wrapper = mountWelcome()
      await flushPromises()
      expect(wrapper.find('[data-testid="usage-stats-card"]').text()).toContain('anonymous usage stats')

      await wrapper.find('[data-testid="usage-stats-enable"]').trigger('click')
      await flushPromises()

      expect(markUsageStatsPrompted).toHaveBeenCalledTimes(1)
      expect(updateUsageStatsEnabled).toHaveBeenCalledWith(true)
      expect(wrapper.find('[data-testid="usage-stats-card"]').exists()).toBe(false)
    })

    it('not now only marks the invitation answered', async () => {
      vi.mocked(fetchUsageStats).mockResolvedValue({ enabled: false, prompted: false })
      const wrapper = mountWelcome()
      await flushPromises()

      await wrapper.find('[data-testid="usage-stats-not-now"]').trigger('click')
      await flushPromises()

      expect(markUsageStatsPrompted).toHaveBeenCalledTimes(1)
      expect(updateUsageStatsEnabled).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="usage-stats-card"]').exists()).toBe(false)
    })
  })
})
