import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SoundListManage from '@/components/SoundListManage.vue'
import MediaManagementView from './MediaManagementView.vue'

vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([]),
  listAmbience: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([]),
  uploadSound: vi.fn().mockResolvedValue({}),
  uploadSoundsBulk: vi.fn().mockResolvedValue({ success: [], failed: [] }),
  deleteSound: vi.fn().mockResolvedValue(undefined),
  soundStreamUrl: (type: string, id: string) => `/api/sounds/${type}/${id}/file`,
}))

describe('mediaManagementView', () => {
  it('renders page title', () => {
    const wrapper = mount(MediaManagementView)
    expect(wrapper.find('h1').text()).toBe('Media Library')
  })

  it('renders SoundListManage for Music, Ambience, and Effects', () => {
    const wrapper = mount(MediaManagementView)
    const lists = wrapper.findAllComponents(SoundListManage)
    expect(lists).toHaveLength(3)
    expect(lists[0]!.props('title')).toBe('Music')
    expect(lists[0]!.props('type')).toBe('music')
    expect(lists[1]!.props('title')).toBe('Ambience')
    expect(lists[1]!.props('type')).toBe('ambience')
    expect(lists[2]!.props('title')).toBe('Effects')
    expect(lists[2]!.props('type')).toBe('effects')
  })
})
