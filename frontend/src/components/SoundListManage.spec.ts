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
  soundStreamUrl: (type: string, id: string) => `hibiki://sound/${type}/${id}`,
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

  it('displays error when loadSounds fails', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockRejectedValue(new Error('Network error'))
    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()
    expect(wrapper.find('.empty-state-error').text()).toBe('Network error')
  })

  it('single file upload shows success toast', async () => {
    const { listMusic, uploadSound } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([])
    vi.mocked(uploadSound).mockResolvedValue({ id: 's1', name: 'test.mp3', filename: 'test.mp3', category: 'music' })

    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()

    const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], writable: false })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.find('.toast-success').text()).toBe('Added to music.')
  })

  it('bulk upload shows count in toast', async () => {
    const { listMusic, uploadSoundsBulk } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([])
    vi.mocked(uploadSoundsBulk).mockResolvedValue({
      success: [
        { id: 's1', name: 'a.mp3', filename: 'a.mp3', category: 'music' },
        { id: 's2', name: 'b.mp3', filename: 'b.mp3', category: 'music' },
      ],
      failed: [],
    })

    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()

    const file1 = new File(['audio'], 'a.mp3', { type: 'audio/mpeg' })
    const file2 = new File(['audio'], 'b.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file1, file2], writable: false })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.find('.toast-success').text()).toBe('Added 2 files to music.')
  })

  it('bulk upload partial failure shows mixed toast', async () => {
    const { listMusic, uploadSoundsBulk } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([])
    vi.mocked(uploadSoundsBulk).mockResolvedValue({
      success: [{ id: 's1', name: 'a.mp3', filename: 'a.mp3', category: 'music' }],
      failed: [{ file: new File([], 'b.mp3'), error: new Error('fail') }],
    })

    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()

    const file1 = new File(['audio'], 'a.mp3', { type: 'audio/mpeg' })
    const file2 = new File(['audio'], 'b.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file1, file2], writable: false })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.find('.toast-success').text()).toBe('Added 1 file, but 1 couldn\'t be uploaded. Check that all files are audio.')
  })

  it('delete flow shows confirm and deletes', async () => {
    const { listMusic, deleteSound } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      { id: 's1', name: 'Track One', filename: 't1.mp3', category: 'music', createdAt: '2024-01-01T00:00:00Z' },
    ])
    vi.mocked(deleteSound).mockResolvedValue(undefined)

    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()

    // Click delete button
    await wrapper.find('.btn-delete').trigger('click')
    await flushPromises()

    // Should show confirm/cancel
    expect(wrapper.find('.btn-confirm-delete').exists()).toBe(true)
    expect(wrapper.find('.btn-cancel-delete').exists()).toBe(true)

    // Click confirm
    await wrapper.find('.btn-confirm-delete').trigger('click')
    await flushPromises()

    expect(deleteSound).toHaveBeenCalledWith('music', 's1')
    expect(wrapper.find('.toast-success').text()).toBe('Removed from library.')
  })

  it('delete cancel hides confirm buttons', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      { id: 's1', name: 'Track One', filename: 't1.mp3', category: 'music', createdAt: '2024-01-01T00:00:00Z' },
    ])

    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()

    await wrapper.find('.btn-delete').trigger('click')
    await flushPromises()
    expect(wrapper.find('.btn-confirm-delete').exists()).toBe(true)

    await wrapper.find('.btn-cancel-delete').trigger('click')
    await flushPromises()
    expect(wrapper.find('.btn-confirm-delete').exists()).toBe(false)
  })

  it('delete error shows error toast', async () => {
    const { listMusic, deleteSound } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      { id: 's1', name: 'Track One', filename: 't1.mp3', category: 'music', createdAt: '2024-01-01T00:00:00Z' },
    ])
    vi.mocked(deleteSound).mockRejectedValue(new Error('Delete failed'))

    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()

    await wrapper.find('.btn-delete').trigger('click')
    await flushPromises()
    await wrapper.find('.btn-confirm-delete').trigger('click')
    await flushPromises()

    expect(wrapper.find('.toast-error').text()).toBe('Delete failed')
  })

  it('sort by date reorders items', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      { id: 's1', name: 'Alpha', filename: 'a.mp3', category: 'music', createdAt: '2024-01-01T00:00:00Z' },
      { id: 's2', name: 'Beta', filename: 'b.mp3', category: 'music', createdAt: '2024-06-01T00:00:00Z' },
    ])

    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()

    // Default sort is name: Alpha, Beta
    let names = wrapper.findAll('.sound-name').map(n => n.text())
    expect(names).toEqual(['Alpha', 'Beta'])

    // Change to date sort
    await wrapper.find('select.sort-select').setValue('date')
    await flushPromises()

    // Date sort (newest first): Beta, Alpha
    names = wrapper.findAll('.sound-name').map(n => n.text())
    expect(names).toEqual(['Beta', 'Alpha'])
  })

  it('toast auto-dismisses after timeout', async () => {
    vi.useFakeTimers()
    const { listMusic, uploadSound } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([])
    vi.mocked(uploadSound).mockResolvedValue({ id: 's1', name: 'test.mp3', filename: 'test.mp3', category: 'music' })

    const wrapper = mount(SoundListManage, {
      props: { title: 'Music', type: 'music' },
    })
    await flushPromises()

    const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], writable: false })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.find('.toast-success').exists()).toBe(true)

    vi.advanceTimersByTime(4000)
    await flushPromises()

    expect(wrapper.find('.toast-success').exists()).toBe(false)
    vi.useRealTimers()
  })
})
