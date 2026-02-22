import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SoundListManage from './SoundListManage.vue'

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

describe('soundListManage', () => {
  it('renders title from prop', () => {
    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    expect(wrapper.find('.sound-title').text()).toBe('Music')
  })

  it('renders Upload button', () => {
    const wrapper = mount(SoundListManage, {
      props: { title: 'Effects', type: 'effects' },
    })
    expect(wrapper.find('.btn-upload').text()).toBe('Upload')
  })

  it('has tag and sort filters', () => {
    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    expect(wrapper.find('.sound-filters').exists()).toBe(true)
    const selects = wrapper.findAll('select.field-input')
    expect(selects.length).toBeGreaterThanOrEqual(2)
  })

  it('renders sound list when listMusic returns items', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      {
        id: 's1',
        name: 'Track One',
        filename: 't1.mp3',
        category: 'music',
        createdAt: '2024-01-01T00:00:00Z',
        tags: ['ambient'],
      },
    ])
    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()
    expect(wrapper.find('.sound-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('Track One')
    expect(wrapper.text()).toContain('ambient')
  })

  it('file input accepts multiple', () => {
    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('multiple')).toBeDefined()
    expect(input.attributes('accept')).toBe('audio/*')
  })
})
