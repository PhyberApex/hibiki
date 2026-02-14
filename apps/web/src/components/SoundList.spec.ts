import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
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

describe('SoundList', () => {
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
})
