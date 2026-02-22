import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SoundList from './SoundList.vue'

vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([]),
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

  it('has filter input', () => {
    const wrapper = mount(SoundList, {
      props: { title: 'Effects', type: 'effects' },
    })
    expect(wrapper.find('.filter-input').exists()).toBe(true)
    expect(wrapper.find('.filter-input').attributes('placeholder')).toMatch(/Search/)
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

  it('filters list by search query', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      { id: 's1', name: 'Alpha', filename: 'a.mp3', category: 'music' },
      { id: 's2', name: 'Beta', filename: 'b.mp3', category: 'music' },
    ])
    const wrapper = mount(SoundList, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()
    expect(wrapper.findAll('.sound-item')).toHaveLength(2)
    await wrapper.find('.filter-input').setValue('Alpha')
    await flushPromises()
    expect(wrapper.findAll('.sound-item')).toHaveLength(1)
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).not.toContain('Beta')
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

  it('renders Play button for each item', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      { id: 's1', name: 'A', filename: 'a.mp3', category: 'music', tags: [] },
    ])
    const wrapper = mount(SoundList, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()
    expect(wrapper.find('.btn-play').exists()).toBe(true)
  })
})
