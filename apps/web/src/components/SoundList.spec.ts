import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SoundList from './SoundList.vue'

vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([]),
  listMusicTags: vi.fn().mockResolvedValue([]),
  listEffectsTags: vi.fn().mockResolvedValue([]),
  setSoundTags: vi.fn().mockResolvedValue({ tags: [] }),
  uploadSound: vi.fn().mockResolvedValue({}),
  deleteSound: vi.fn().mockResolvedValue(undefined),
  soundStreamUrl: (type: string, id: string) => `/api/sounds/${type}/${id}/file`,
}))

describe('soundList', () => {
  it('renders title from prop', () => {
    const wrapper = mount(SoundList, {
      props: { title: 'Music', type: 'music' },
    })
    expect(wrapper.find('.sound-title').text()).toBe('Music')
  })

  it('shows loading then empty message for music', async () => {
    const wrapper = mount(SoundList, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()
    expect(wrapper.find('.sound-message').exists()).toBe(true)
    expect(wrapper.find('.sound-message').text()).toMatch(/No sounds yet|Loading/)
  })

  it('renders Upload button', () => {
    const wrapper = mount(SoundList, {
      props: { title: 'Effects', type: 'effects' },
    })
    expect(wrapper.find('.btn-upload').text()).toBe('Upload')
  })

  it('has tag and sort filters', () => {
    const wrapper = mount(SoundList, {
      props: { title: 'Music', type: 'music' },
    })
    expect(wrapper.find('.sound-filters').exists()).toBe(true)
    const selects = wrapper.findAll('.field-input')
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
    const wrapper = mount(SoundList, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()
    expect(wrapper.find('.sound-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('Track One')
  })

  it('shows error when list fails', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockRejectedValue(new Error('Network error'))
    const wrapper = mount(SoundList, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Network error')
  })

  it('renders multiple items and sort select', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      { id: 's1', name: 'A', filename: 'a.mp3', category: 'music', createdAt: '2024-01-02', tags: [] },
      { id: 's2', name: 'B', filename: 'b.mp3', category: 'music', createdAt: '2024-01-01', tags: [] },
    ])
    const wrapper = mount(SoundList, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()
    expect(wrapper.find('.sound-list').exists()).toBe(true)
    expect(wrapper.findAll('.sound-item')).toHaveLength(2)
    const selects = wrapper.findAll('select.field-input')
    expect(selects.length).toBeGreaterThanOrEqual(2)
  })
})
