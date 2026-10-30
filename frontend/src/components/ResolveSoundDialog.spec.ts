import type { SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openExternal } from '@/api/electron'
import { uploadSound } from '@/api/sounds'
import ResolveSoundDialog from './ResolveSoundDialog.vue'

vi.mock('@/api/electron', () => ({
  openExternal: vi.fn(),
}))

vi.mock('@/api/sounds', () => ({
  uploadSound: vi.fn(),
}))

function sound(id: string, name: string): SoundFile {
  return {
    id,
    name,
    filename: `${id}.mp3`,
    category: 'ambience',
  }
}

const rain = sound('rain-id', 'Rain')
const wind = sound('wind-id', 'Wind')

function mountDialog(item: SceneItem = { soundId: 'missing-id', soundName: 'Thunder' }, sounds: SoundFile[] = [rain, wind]) {
  return mount(ResolveSoundDialog, {
    props: { item, category: 'ambience', sounds },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function chooseButton(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.find('.resolve-option .btn-primary')
}

async function chooseFile(wrapper: ReturnType<typeof mountDialog>, files: File[]) {
  const input = wrapper.find<HTMLInputElement>('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
}

describe('resolveSoundDialog', () => {
  beforeEach(() => {
    vi.mocked(uploadSound).mockReset()
    vi.mocked(openExternal).mockReset()
  })

  describe('header', () => {
    it('names the missing sound in the title and the dialog label', () => {
      const wrapper = mountDialog()
      expect(wrapper.find('.resolve-title').text()).toBe('Resolve: "Thunder"')
      expect(wrapper.find('[role="dialog"]').attributes('aria-label')).toBe('Resolve missing sound: Thunder')
    })

    it('falls back to the sound id when the item has no name', () => {
      const wrapper = mountDialog({ soundId: 'missing-id' })
      expect(wrapper.find('.resolve-title').text()).toBe('Resolve: "missing-id"')
      expect(wrapper.find('[role="dialog"]').attributes('aria-label')).toBe('Resolve missing sound: missing-id')
    })
  })

  describe('source', () => {
    it('hides the source block when the item has none', () => {
      const wrapper = mountDialog()
      expect(wrapper.find('.resolve-source').exists()).toBe(false)
    })

    it('links a source with a URL and opens it externally', async () => {
      const wrapper = mountDialog({
        soundId: 'x',
        source: { name: 'Freesound', url: 'https://freesound.org/s/1', note: 'CC-BY, credit the author' },
      })
      const link = wrapper.find('.source-info-link')
      expect(link.text()).toBe('Freesound')
      expect(wrapper.find('.source-info-note').text()).toBe('CC-BY, credit the author')
      await link.trigger('click')
      expect(openExternal).toHaveBeenCalledWith('https://freesound.org/s/1')
    })

    it('shows a source without a URL or note as plain text', () => {
      const wrapper = mountDialog({
        soundId: 'x',
        source: { name: 'Record it yourself' },
      })
      expect(wrapper.find('.source-info-link').exists()).toBe(false)
      expect(wrapper.find('.source-info-name').text()).toBe('Record it yourself')
      expect(wrapper.find('.source-info-note').exists()).toBe(false)
    })
  })

  describe('link from library', () => {
    it('lists every library sound after a placeholder', () => {
      const wrapper = mountDialog()
      const options = wrapper.findAll('.resolve-select option')
      expect(options.map(o => [
        o.attributes('value'),
        o.text(),
      ])).toEqual([
        ['', 'Pick from library...'],
        ['rain-id', 'Rain'],
        ['wind-id', 'Wind'],
      ])
    })

    it('emits resolved with the picked sound', async () => {
      const wrapper = mountDialog()
      await wrapper.find('.resolve-select').setValue('wind-id')
      expect(wrapper.emitted('resolved')).toEqual([
        ['wind-id', 'Wind'],
      ])
    })

    it('emits nothing when the placeholder is picked', async () => {
      const wrapper = mountDialog()
      await wrapper.find('.resolve-select').setValue('')
      expect(wrapper.emitted('resolved')).toBeUndefined()
    })

    it('emits nothing for a value that is not in the library', async () => {
      const wrapper = mountDialog()
      const select = wrapper.find<HTMLSelectElement>('.resolve-select')
      const stale = document.createElement('option')
      stale.value = 'gone-id'
      select.element.appendChild(stale)
      await select.setValue('gone-id')
      expect(wrapper.emitted('resolved')).toBeUndefined()
    })
  })

  describe('upload a file', () => {
    it('opens the hidden file picker from the button', async () => {
      const wrapper = mountDialog()
      const input = wrapper.find<HTMLInputElement>('input[type="file"]')
      const click = vi.spyOn(input.element, 'click')
      await chooseButton(wrapper).trigger('click')
      expect(click).toHaveBeenCalled()
      expect(input.attributes('accept')).toBe('audio/*')
    })

    it('uploads the chosen file into the dialog\'s category and emits the new sound', async () => {
      vi.mocked(uploadSound).mockResolvedValue(sound('new-id', 'Thunder.mp3'))
      const wrapper = mountDialog()
      const file = new File(['x'], 'thunder.mp3', { type: 'audio/mpeg' })
      await chooseFile(wrapper, [file])
      await flushPromises()
      expect(uploadSound).toHaveBeenCalledWith('ambience', file)
      expect(wrapper.emitted('resolved')).toEqual([
        ['new-id', 'Thunder.mp3'],
      ])
    })

    it('disables the button while uploading', async () => {
      const pending = deferred<SoundFile>()
      vi.mocked(uploadSound).mockReturnValue(pending.promise)
      const wrapper = mountDialog()
      await chooseFile(wrapper, [
        new File(['x'], 'thunder.mp3'),
      ])
      const button = chooseButton(wrapper)
      expect(button.text()).toBe('Uploading...')
      expect(button.attributes('disabled')).toBeDefined()

      pending.resolve(sound('new-id', 'Thunder'))
      await flushPromises()
      expect(button.text()).toBe('Choose file')
      expect(button.attributes('disabled')).toBeUndefined()
    })

    it('shows the error when the upload fails and emits nothing', async () => {
      vi.mocked(uploadSound).mockRejectedValue(new Error('Unsupported format'))
      const wrapper = mountDialog()
      await chooseFile(wrapper, [
        new File(['x'], 'thunder.txt'),
      ])
      await flushPromises()
      expect(wrapper.find('.resolve-error').text()).toBe('Unsupported format')
      expect(wrapper.emitted('resolved')).toBeUndefined()
      expect(chooseButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('falls back to a generic message for a non-Error rejection', async () => {
      vi.mocked(uploadSound).mockRejectedValue('nope')
      const wrapper = mountDialog()
      await chooseFile(wrapper, [
        new File(['x'], 'thunder.mp3'),
      ])
      await flushPromises()
      expect(wrapper.find('.resolve-error').text()).toBe('Upload failed')
    })

    it('clears a previous error when a new upload starts', async () => {
      vi.mocked(uploadSound).mockRejectedValueOnce(new Error('Unsupported format'))
      const wrapper = mountDialog()
      await chooseFile(wrapper, [
        new File(['x'], 'thunder.txt'),
      ])
      await flushPromises()
      expect(wrapper.find('.resolve-error').exists()).toBe(true)

      const pending = deferred<SoundFile>()
      vi.mocked(uploadSound).mockReturnValueOnce(pending.promise)
      await chooseFile(wrapper, [
        new File(['x'], 'thunder.mp3'),
      ])
      expect(wrapper.find('.resolve-error').exists()).toBe(false)
      pending.resolve(sound('new-id', 'Thunder'))
      await flushPromises()
    })

    it('does nothing when the picker is dismissed without a file', async () => {
      const wrapper = mountDialog()
      await chooseFile(wrapper, [])
      await flushPromises()
      expect(uploadSound).not.toHaveBeenCalled()
      expect(wrapper.emitted('resolved')).toBeUndefined()
    })
  })

  describe('closing', () => {
    it('emits close from the close button', async () => {
      const wrapper = mountDialog()
      await wrapper.find('button[aria-label="Close"]').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
      expect(wrapper.emitted('resolved')).toBeUndefined()
    })

    it('emits close when the backdrop is clicked, not the modal', async () => {
      const wrapper = mountDialog()
      await wrapper.find('.resolve-modal').trigger('click')
      expect(wrapper.emitted('close')).toBeUndefined()
      await wrapper.find('.resolve-overlay').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('emits close on Escape and stops listening once unmounted', () => {
      const onClose = vi.fn()
      const wrapper = mount(ResolveSoundDialog, {
        props: {
          item: { soundId: 'missing-id', soundName: 'Thunder' },
          category: 'ambience',
          sounds: [rain],
          onClose,
        },
      })
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(onClose).toHaveBeenCalledTimes(1)
      wrapper.unmount()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('ignores keys other than Escape', () => {
      const wrapper = mountDialog()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      expect(wrapper.emitted('close')).toBeUndefined()
    })
  })

  describe('focus', () => {
    it('is modal and moves focus to the first control on open', () => {
      const wrapper = mount(ResolveSoundDialog, {
        props: {
          item: { soundId: 'missing-id', soundName: 'Thunder' },
          category: 'ambience',
          sounds: [rain],
        },
        attachTo: document.body,
      })
      expect(wrapper.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
      expect(document.activeElement).toBe(wrapper.find('button[aria-label="Close"]').element)
      wrapper.unmount()
    })
  })
})
