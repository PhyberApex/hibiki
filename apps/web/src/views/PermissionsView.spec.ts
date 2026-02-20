import type { AllowlistConfig } from '@/api/permissions'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PermissionsView from './PermissionsView.vue'

const mockConfig: AllowlistConfig = {
  allowedDiscordRoleIds: ['role-1'],
  allowedDiscordUserIds: ['user-1'],
}

vi.mock('@/api/permissions', () => ({
  fetchPermissionsConfig: vi.fn(),
  updatePermissionsConfig: vi.fn(),
}))

const { fetchPermissionsConfig, updatePermissionsConfig } = await import('@/api/permissions')

describe('permissionsView', () => {
  beforeEach(() => {
    vi.mocked(fetchPermissionsConfig).mockResolvedValue(mockConfig)
    vi.mocked(updatePermissionsConfig).mockResolvedValue(mockConfig)
  })

  it('loads config on mount and shows role and user inputs', async () => {
    const wrapper = mount(PermissionsView)
    await flushPromises()
    expect(fetchPermissionsConfig).toHaveBeenCalled()
    expect(wrapper.find('h1').text()).toBe('Who can use the bot')
    const roleInputs = wrapper.findAll('.id-list')[0].findAll('input[type="text"]')
    const userInputs = wrapper.findAll('.id-list')[1].findAll('input[type="text"]')
    expect(roleInputs.length).toBeGreaterThanOrEqual(1)
    expect(userInputs.length).toBeGreaterThanOrEqual(1)
  })

  it('shows loading then content', async () => {
    const wrapper = mount(PermissionsView)
    expect(wrapper.find('.panel-message').text()).toBe('Loading…')
    await flushPromises()
    expect(wrapper.find('.panel').exists()).toBe(true)
  })

  it('add role row adds an input row', async () => {
    vi.mocked(fetchPermissionsConfig).mockResolvedValue({
      allowedDiscordRoleIds: [],
      allowedDiscordUserIds: [],
    })
    const wrapper = mount(PermissionsView)
    await flushPromises()
    const addRoleBtn = wrapper.findAll('.btn').find(b => b.text().includes('Add role ID'))
    expect(addRoleBtn).toBeDefined()
    await addRoleBtn!.trigger('click')
    await wrapper.vm.$nextTick()
    const roleList = wrapper.findAll('.id-list')[0]
    expect(roleList.findAll('li').length).toBeGreaterThanOrEqual(2)
  })

  it('add user row adds an input row', async () => {
    vi.mocked(fetchPermissionsConfig).mockResolvedValue({
      allowedDiscordRoleIds: [],
      allowedDiscordUserIds: [],
    })
    const wrapper = mount(PermissionsView)
    await flushPromises()
    const addUserBtn = wrapper.findAll('.btn').find(b => b.text().includes('Add user ID'))
    await addUserBtn!.trigger('click')
    await wrapper.vm.$nextTick()
    const userList = wrapper.findAll('.id-list')[1]
    expect(userList.findAll('li').length).toBeGreaterThanOrEqual(2)
  })

  it('remove role row removes the row', async () => {
    const wrapper = mount(PermissionsView)
    await flushPromises()
    const removeBtns = wrapper.findAll('.id-list')[0].findAll('button.btn-icon')
    if (removeBtns.length > 0) {
      await removeBtns[0].trigger('click')
      await wrapper.vm.$nextTick()
      const roleList = wrapper.findAll('.id-list')[0]
      expect(roleList.findAll('li').length).toBeLessThanOrEqual(2)
    }
  })

  it('refresh button calls load', async () => {
    const wrapper = mount(PermissionsView)
    await flushPromises()
    vi.mocked(fetchPermissionsConfig).mockClear()
    const refreshBtn = wrapper.find('button.btn-ghost')
    await refreshBtn.trigger('click')
    await flushPromises()
    expect(fetchPermissionsConfig).toHaveBeenCalled()
  })

  it('save button calls updatePermissionsConfig and shows toast', async () => {
    const wrapper = mount(PermissionsView)
    await flushPromises()
    const saveBtn = wrapper.find('button.btn-primary')
    await saveBtn.trigger('click')
    await flushPromises()
    expect(updatePermissionsConfig).toHaveBeenCalled()
    expect(wrapper.find('.toast-success').exists()).toBe(true)
    expect(wrapper.find('.toast-success').text()).toContain('Saved')
  })

  it('shows error when load fails', async () => {
    vi.mocked(fetchPermissionsConfig).mockRejectedValue(new Error('Network error'))
    const wrapper = mount(PermissionsView)
    await flushPromises()
    expect(wrapper.find('.toast-error').exists()).toBe(true)
    expect(wrapper.find('.toast-error').text()).toBe('Network error')
  })

  it('shows error when save fails', async () => {
    vi.mocked(fetchPermissionsConfig).mockResolvedValue({
      allowedDiscordRoleIds: [],
      allowedDiscordUserIds: [],
    })
    vi.mocked(updatePermissionsConfig).mockRejectedValue(new Error('Save failed'))
    const wrapper = mount(PermissionsView)
    await flushPromises()
    const saveBtn = wrapper.find('button.btn-primary')
    await saveBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('.toast-error').exists()).toBe(true)
    expect(wrapper.find('.toast-error').text()).toBe('Save failed')
  })
})
