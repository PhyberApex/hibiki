import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useToastStore } from '@/stores/toast'
import SoundListManage from './SoundListManage.vue'

vi.mock('@/api/sounds', () => ({
  listMusic: vi.fn().mockResolvedValue([]),
  listAmbience: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([]),
  uploadSound: vi.fn().mockResolvedValue({}),
  uploadSoundsBulk: vi.fn().mockResolvedValue({ success: [], failed: [] }),
  deleteSound: vi.fn().mockResolvedValue(undefined),
  updateSoundTags: vi.fn().mockImplementation(async (_type: string, _id: string, tags: string[]) => tags),
  soundStreamUrl: (type: string, id: string) => `hibiki://sound/${type}/${id}`,
}))

function lastToast(type: string) {
  return useToastStore().toasts.findLast(t => t.type === type)?.text
}

describe('soundListManage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders Add button', () => {
    const wrapper = mount(SoundListManage, {
      props: { type: 'effects' },
    })
    expect(wrapper.find('.btn-upload').text()).toBe('+ Add')
  })

  it('shows sort select only with 2+ items', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      {
        id: 's1',
        name: 'Alpha',
        filename: 'a.mp3',
        category: 'music',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 's2',
        name: 'Beta',
        filename: 'b.mp3',
        category: 'music',
        createdAt: '2024-06-01T00:00:00Z',
      },
    ])

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    expect(wrapper.findAll('select.sort-select').length).toBe(1)
  })

  it('hides sort select with 0 items', () => {
    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    expect(wrapper.findAll('select.sort-select').length).toBe(0)
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
      props: { type: 'music' },
    })
    await flushPromises()
    expect(wrapper.find('.sound-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('Track One')
  })

  it('file input accepts multiple', () => {
    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('multiple')).toBeDefined()
    expect(input.attributes('accept')).toBe('audio/*')
  })

  it('displays error when loadSounds fails', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockRejectedValue(new Error('Network error'))
    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()
    expect(wrapper.find('.empty-state-error').text()).toBe('Network error')
  })

  it('single file upload shows success toast', async () => {
    const { listMusic, uploadSound } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([])
    vi.mocked(uploadSound).mockResolvedValue({
      id: 's1',
      name: 'test.mp3',
      filename: 'test.mp3',
      category: 'music',
    })

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [file],
      writable: false,
    })
    await input.trigger('change')
    await flushPromises()

    expect(lastToast('success')).toBe('Added to music.')
  })

  it('bulk upload shows count in toast', async () => {
    const { listMusic, uploadSoundsBulk } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([])
    vi.mocked(uploadSoundsBulk).mockResolvedValue({
      success: [
        {
          id: 's1',
          name: 'a.mp3',
          filename: 'a.mp3',
          category: 'music',
        },
        {
          id: 's2',
          name: 'b.mp3',
          filename: 'b.mp3',
          category: 'music',
        },
      ],
      failed: [],
    })

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    const file1 = new File(['audio'], 'a.mp3', { type: 'audio/mpeg' })
    const file2 = new File(['audio'], 'b.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [file1, file2],
      writable: false,
    })
    await input.trigger('change')
    await flushPromises()

    expect(lastToast('success')).toBe('Added 2 files to music.')
  })

  it('bulk upload partial failure shows mixed toast', async () => {
    const { listMusic, uploadSoundsBulk } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([])
    vi.mocked(uploadSoundsBulk).mockResolvedValue({
      success: [
        {
          id: 's1',
          name: 'a.mp3',
          filename: 'a.mp3',
          category: 'music',
        },
      ],
      failed: [
        {
          file: new File([], 'b.mp3'),
          error: new Error('fail'),
        },
      ],
    })

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    const file1 = new File(['audio'], 'a.mp3', { type: 'audio/mpeg' })
    const file2 = new File(['audio'], 'b.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [file1, file2],
      writable: false,
    })
    await input.trigger('change')
    await flushPromises()

    expect(lastToast('success')).toBe('Added 1 file, but 1 couldn\'t be uploaded. Check that all files are audio.')
  })

  it('delete flow shows confirm and deletes', async () => {
    const { listMusic, deleteSound } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      {
        id: 's1',
        name: 'Track One',
        filename: 't1.mp3',
        category: 'music',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ])
    vi.mocked(deleteSound).mockResolvedValue(undefined)

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    await wrapper.find('.btn-delete').trigger('click')
    await flushPromises()

    expect(wrapper.find('.btn-confirm-delete').exists()).toBe(true)
    expect(wrapper.find('.btn-cancel-delete').exists()).toBe(true)

    await wrapper.find('.btn-confirm-delete').trigger('click')
    await flushPromises()

    expect(deleteSound).toHaveBeenCalledWith('music', 's1')
    expect(lastToast('success')).toBe('Removed from library.')
  })

  it('delete cancel hides confirm buttons', async () => {
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
      props: { type: 'music' },
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
      {
        id: 's1',
        name: 'Track One',
        filename: 't1.mp3',
        category: 'music',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ])
    vi.mocked(deleteSound).mockRejectedValue(new Error('Delete failed'))

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    await wrapper.find('.btn-delete').trigger('click')
    await flushPromises()
    await wrapper.find('.btn-confirm-delete').trigger('click')
    await flushPromises()

    expect(lastToast('error')).toBe('Delete failed')
  })

  it('sort by date reorders items', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      {
        id: 's1',
        name: 'Alpha',
        filename: 'a.mp3',
        category: 'music',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 's2',
        name: 'Beta',
        filename: 'b.mp3',
        category: 'music',
        createdAt: '2024-06-01T00:00:00Z',
      },
    ])

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    let names = wrapper.findAll('.sound-name').map(n => n.text())
    expect(names).toEqual(['Alpha', 'Beta'])

    await wrapper.find('select.sort-select').setValue('date')
    await flushPromises()

    names = wrapper.findAll('.sound-name').map(n => n.text())
    expect(names).toEqual(['Beta', 'Alpha'])
  })

  it('search filters items by name', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      {
        id: 's1',
        name: 'Alpha',
        filename: 'a.mp3',
        category: 'music',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 's2',
        name: 'Beta',
        filename: 'b.mp3',
        category: 'music',
        createdAt: '2024-06-01T00:00:00Z',
      },
    ])

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    expect(wrapper.findAll('.sound-name')).toHaveLength(2)

    await wrapper.find('.search-input').setValue('alpha')
    await flushPromises()

    const names = wrapper.findAll('.sound-name').map(n => n.text())
    expect(names).toEqual(['Alpha'])
  })

  it('shows no-match message when search finds nothing', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      {
        id: 's1',
        name: 'Alpha',
        filename: 'a.mp3',
        category: 'music',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ])

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    await wrapper.find('.search-input').setValue('zzz')
    await flushPromises()

    expect(wrapper.text()).toContain('No matches for "zzz"')
  })

  it('displays file extension badge', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      {
        id: 's1',
        name: 'Track',
        filename: 'track.ogg',
        category: 'music',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ])

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    expect(wrapper.find('.sound-ext').text()).toBe('OGG')
  })

  it('displays formatted file size', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([
      {
        id: 's1',
        name: 'Track',
        filename: 'track.mp3',
        category: 'music',
        size: 2_500_000,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ])

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('2.4 MB')
  })

  it('toast auto-dismisses after timeout', async () => {
    vi.useFakeTimers()
    const { listMusic, uploadSound } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValue([])
    vi.mocked(uploadSound).mockResolvedValue({
      id: 's1',
      name: 'test.mp3',
      filename: 'test.mp3',
      category: 'music',
    })

    const wrapper = mount(SoundListManage, {
      props: { type: 'music' },
    })
    await flushPromises()

    const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [file],
      writable: false,
    })
    await input.trigger('change')
    await flushPromises()

    expect(lastToast('success')).toBeDefined()

    vi.advanceTimersByTime(4000)
    await flushPromises()

    expect(useToastStore().toasts).toHaveLength(0)
    vi.useRealTimers()
  })

  describe('sound tags', () => {
    it('shows existing tags as chips for music', async () => {
      const { listMusic } = await import('@/api/sounds')
      vi.mocked(listMusic).mockResolvedValue([
        {
          id: 's1',
          name: 'Tavern',
          filename: 't.mp3',
          category: 'music',
          createdAt: '2024-01-01T00:00:00Z',
          tags: ['warm', 'candlelit'],
        },
      ])
      const wrapper = mount(SoundListManage, {
        props: { type: 'music' },
      })
      await flushPromises()
      const chips = wrapper.findAll('.tag-chip')
      expect(chips.map(c => c.text())).toEqual(['warm', 'candlelit'])
    })

    it('does not offer tag editing for effects', async () => {
      const { listEffects } = await import('@/api/sounds')
      vi.mocked(listEffects).mockResolvedValue([
        {
          id: 'e1',
          name: 'Boom',
          filename: 'b.wav',
          category: 'effects',
          createdAt: '2024-01-01T00:00:00Z',
          tags: [],
        },
      ])
      const wrapper = mount(SoundListManage, {
        props: { type: 'effects' },
      })
      await flushPromises()
      expect(wrapper.find('.btn-edit-tags').exists()).toBe(false)
    })

    it('edits tags inline and saves them comma-separated', async () => {
      const { listAmbience, updateSoundTags } = await import('@/api/sounds')
      vi.mocked(listAmbience).mockResolvedValue([
        {
          id: 'a1',
          name: 'Rain',
          filename: 'r.mp3',
          category: 'ambience',
          createdAt: '2024-01-01T00:00:00Z',
          tags: [],
        },
      ])
      const wrapper = mount(SoundListManage, {
        props: { type: 'ambience' },
      })
      await flushPromises()
      await wrapper.find('.btn-edit-tags').trigger('click')
      const input = wrapper.find('input.tags-input')
      expect(input.exists()).toBe(true)
      await input.setValue('stormy, wet , night')
      await input.trigger('keydown.enter')
      await flushPromises()
      expect(updateSoundTags).toHaveBeenCalledWith('ambience', 'a1', ['stormy', 'wet', 'night'])
      expect(wrapper.findAll('.tag-chip').map(c => c.text())).toEqual(['stormy', 'wet', 'night'])
      expect(wrapper.find('input.tags-input').exists()).toBe(false)
    })

    it('escape cancels tag editing without saving', async () => {
      const { listAmbience, updateSoundTags } = await import('@/api/sounds')
      vi.mocked(updateSoundTags).mockClear()
      vi.mocked(listAmbience).mockResolvedValue([
        {
          id: 'a1',
          name: 'Rain',
          filename: 'r.mp3',
          category: 'ambience',
          createdAt: '2024-01-01T00:00:00Z',
          tags: ['old'],
        },
      ])
      const wrapper = mount(SoundListManage, {
        props: { type: 'ambience' },
      })
      await flushPromises()
      await wrapper.find('.btn-edit-tags').trigger('click')
      const input = wrapper.find('input.tags-input')
      await input.setValue('new')
      await input.trigger('keydown.escape')
      await flushPromises()
      expect(updateSoundTags).not.toHaveBeenCalled()
      expect(wrapper.findAll('.tag-chip').map(c => c.text())).toEqual(['old'])
    })

    it('shows an error toast when saving tags fails', async () => {
      const { listMusic, updateSoundTags } = await import('@/api/sounds')
      vi.mocked(listMusic).mockResolvedValue([
        {
          id: 's1',
          name: 'Tavern',
          filename: 't.mp3',
          category: 'music',
          createdAt: '2024-01-01T00:00:00Z',
          tags: [],
        },
      ])
      vi.mocked(updateSoundTags).mockRejectedValueOnce(new Error('disk full'))
      const wrapper = mount(SoundListManage, {
        props: { type: 'music' },
      })
      await flushPromises()
      await wrapper.find('.btn-edit-tags').trigger('click')
      await wrapper.find('input.tags-input').setValue('x')
      await wrapper.find('input.tags-input').trigger('keydown.enter')
      await flushPromises()
      expect(lastToast('error')).toContain('disk full')
    })
  })

  describe('preview playback', () => {
    beforeEach(async () => {
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
      vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
      const { listMusic } = await import('@/api/sounds')
      vi.mocked(listMusic).mockResolvedValue([
        {
          id: 's1',
          name: 'Long Track',
          filename: 'long.mp3',
          category: 'music',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ])
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    function mountInKeepAlive() {
      const shown = ref(true)
      const Host = defineComponent({
        setup() {
          return () => h(KeepAlive, null, [
            shown.value
              ? h(SoundListManage, { type: 'music' })
              : h('div', 'other panel'),
          ])
        },
      })
      return {
        wrapper: mount(Host),
        shown,
      }
    }

    it('stops the preview when the panel is deactivated', async () => {
      const { wrapper, shown } = mountInKeepAlive()
      await flushPromises()
      await wrapper.find('.sound-play-btn').trigger('click')
      await flushPromises()
      const audio = wrapper.find('audio').element as HTMLAudioElement
      expect(audio.getAttribute('src')).toBe('hibiki://sound/music/s1')
      const pause = vi.mocked(HTMLMediaElement.prototype.pause)
      pause.mockClear()

      shown.value = false
      await flushPromises()

      expect(pause).toHaveBeenCalled()
      expect(audio.hasAttribute('src')).toBe(false)

      shown.value = true
      await flushPromises()
      expect(wrapper.find('.sound-item-playing').exists()).toBe(false)
      expect(wrapper.find('.icon-play').exists()).toBe(true)
    })

    it('stops the preview when the hosting view is deactivated (nested KeepAlive)', async () => {
      const viewShown = ref(true)
      const MediaView = defineComponent({
        setup() {
          return () => h(KeepAlive, null, [
            h(SoundListManage, { type: 'music' }),
          ])
        },
      })
      const App = defineComponent({
        setup() {
          return () => h(KeepAlive, null, [
            viewShown.value
              ? h(MediaView)
              : h('div', 'scenes view'),
          ])
        },
      })
      const wrapper = mount(App)
      await flushPromises()
      await wrapper.find('.sound-play-btn').trigger('click')
      await flushPromises()
      const audio = wrapper.find('audio').element as HTMLAudioElement
      const pause = vi.mocked(HTMLMediaElement.prototype.pause)
      pause.mockClear()

      viewShown.value = false
      await flushPromises()

      expect(pause).toHaveBeenCalled()
      expect(audio.hasAttribute('src')).toBe(false)
    })

    it('stops the preview when a Scene starts playing', async () => {
      const wrapper = mount(SoundListManage, {
        props: { type: 'music' },
      })
      await flushPromises()
      await wrapper.find('.sound-play-btn').trigger('click')
      await flushPromises()
      const audio = wrapper.find('audio').element as HTMLAudioElement
      expect(audio.getAttribute('src')).toBe('hibiki://sound/music/s1')

      usePlayerStore().playingSceneId = 'scene-1'
      await flushPromises()

      expect(audio.hasAttribute('src')).toBe(false)
      expect(wrapper.find('.icon-play').exists()).toBe(true)
    })

    it('does not start the preview when the panel is left before playback begins', async () => {
      const { wrapper, shown } = mountInKeepAlive()
      await flushPromises()
      const play = vi.mocked(HTMLMediaElement.prototype.play)
      void wrapper.find('.sound-play-btn').trigger('click')
      shown.value = false
      await flushPromises()

      expect(play).not.toHaveBeenCalled()
    })

    it('stops the preview before deleting the sound it is playing', async () => {
      const { deleteSound } = await import('@/api/sounds')
      const wrapper = mount(SoundListManage, {
        props: { type: 'music' },
      })
      await flushPromises()
      await wrapper.find('.sound-play-btn').trigger('click')
      await flushPromises()
      const audio = wrapper.find('audio').element as HTMLAudioElement
      const pause = vi.mocked(HTMLMediaElement.prototype.pause)
      const load = vi.mocked(HTMLMediaElement.prototype.load)
      pause.mockClear()
      load.mockClear()
      let srcAtDelete: string | null = 'unset'
      vi.mocked(deleteSound).mockImplementationOnce(async () => {
        srcAtDelete = audio.getAttribute('src')
      })

      await wrapper.find('.btn-delete').trigger('click')
      await wrapper.find('.btn-confirm-delete').trigger('click')
      await flushPromises()

      expect(deleteSound).toHaveBeenCalledWith('music', 's1')
      expect(srcAtDelete).toBeNull()
      expect(pause.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deleteSound).mock.invocationCallOrder.at(-1)!)
      // Reloading without a src aborts the hibiki://sound request so its file handle is released.
      expect(load).toHaveBeenCalled()
    })

    it('keeps the preview playing when another sound is deleted', async () => {
      const { listMusic, deleteSound } = await import('@/api/sounds')
      vi.mocked(listMusic).mockResolvedValue([
        {
          id: 's1',
          name: 'Long Track',
          filename: 'long.mp3',
          category: 'music',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 's2',
          name: 'Other Track',
          filename: 'other.mp3',
          category: 'music',
          createdAt: '2024-01-02T00:00:00Z',
        },
      ])
      vi.mocked(deleteSound).mockResolvedValueOnce(undefined)
      const wrapper = mount(SoundListManage, {
        props: { type: 'music' },
      })
      await flushPromises()
      const rowOf = (name: string) => wrapper.findAll('.sound-item').find(r => r.text().includes(name))!
      await rowOf('Long Track').find('.sound-play-btn').trigger('click')
      await flushPromises()
      const audio = wrapper.find('audio').element as HTMLAudioElement

      await rowOf('Other Track').find('.btn-delete').trigger('click')
      await rowOf('Other Track').find('.btn-confirm-delete').trigger('click')
      await flushPromises()

      expect(deleteSound).toHaveBeenCalledWith('music', 's2')
      expect(audio.getAttribute('src')).toBe('hibiki://sound/music/s1')
    })

    it('stops the preview when the panel is unmounted', async () => {
      const wrapper = mount(SoundListManage, {
        props: { type: 'music' },
      })
      await flushPromises()
      await wrapper.find('.sound-play-btn').trigger('click')
      await flushPromises()
      const audio = wrapper.find('audio').element as HTMLAudioElement
      const pause = vi.mocked(HTMLMediaElement.prototype.pause)
      pause.mockClear()

      wrapper.unmount()

      expect(pause).toHaveBeenCalled()
      expect(audio.hasAttribute('src')).toBe(false)
    })
  })
})
