import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SoundListManage from './SoundListManage.vue'

vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([]),
  listAmbience: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([]),
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
    expect(wrapper.find('.panel-title').text()).toContain('Music')
  })

  it('renders Add button', () => {
    const wrapper = mount(SoundListManage, {
      props: { title: 'Effects', type: 'effects' },
    })
    expect(wrapper.find('.btn-upload').text()).toBe('+ Add')
  })

  it('has sort select', () => {
    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    const selects = wrapper.findAll('select.sort-select')
    expect(selects.length).toBe(1)
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
      },
    ])
    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()
    expect(wrapper.find('.sound-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('Track One')
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
