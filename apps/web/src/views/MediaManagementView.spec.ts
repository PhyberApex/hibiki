import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SoundListManage from '@/components/SoundListManage.vue'
import MediaManagementView from './MediaManagementView.vue'

vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([]),
  listMusicTags: vi.fn().mockResolvedValue([]),
  listEffectsTags: vi.fn().mockResolvedValue([]),
  setSoundTags: vi.fn().mockResolvedValue({ tags: [] }),
  uploadSound: vi.fn().mockResolvedValue({}),
  uploadSoundsBulk: vi.fn().mockResolvedValue({ success: [], failed: [] }),
  deleteSound: vi.fn().mockResolvedValue(undefined),
  soundStreamUrl: (type: string, id: string) => `/api/sounds/${type}/${id}/file`,
}))

describe('mediaManagementView', () => {
  it('renders Media Management heading', () => {
    const wrapper = mount(MediaManagementView)
    expect(wrapper.find('h1').text()).toBe('Media Management')
  })

  it('renders Library eyebrow', () => {
    const wrapper = mount(MediaManagementView)
    expect(wrapper.find('.eyebrow').text()).toBe('Library')
  })

  it('renders intro text', () => {
    const wrapper = mount(MediaManagementView)
    expect(wrapper.find('.page-intro').text()).toContain('Upload')
    expect(wrapper.find('.page-intro').text()).toContain('tags')
  })

  it('renders SoundListManage for Music and Effects', () => {
    const wrapper = mount(MediaManagementView)
    const lists = wrapper.findAllComponents(SoundListManage)
    expect(lists).toHaveLength(2)
    expect(lists[0]!.props('title')).toBe('Music')
    expect(lists[0]!.props('type')).toBe('music')
    expect(lists[1]!.props('title')).toBe('Effects')
    expect(lists[1]!.props('type')).toBe('effects')
  })
})
