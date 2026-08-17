import type { SoundFile } from '@/api/sounds'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openFileDialog } from '@/api/config'
import { analyzeImageVibe, matchVibe } from '@/api/vision'
import VisionToVibeDialog from './VisionToVibeDialog.vue'

vi.mock('@/api/config', () => ({
  openFileDialog: vi.fn(),
}))

vi.mock('@/api/vision', () => ({
  analyzeImageVibe: vi.fn(),
  matchVibe: vi.fn(),
}))

const router = { push: vi.fn() }
vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
  useRouter: () => router,
}))

function sound(id: string, category: 'music' | 'ambience', tags: string[] = []): SoundFile {
  return { id, name: id.toUpperCase(), filename: `${id}.mp3`, category, createdAt: '2026-01-01T00:00:00Z', tags }
}

const tavern = sound('tavern', 'music', ['warm', 'tavern'])
const rain = sound('rain', 'ambience', ['storm', 'wet'])

function mountDialog(overrides: Partial<{ musicSounds: SoundFile[], ambienceSounds: SoundFile[], musicInScene: string[], ambienceInScene: string[] }> = {}) {
  return mount(VisionToVibeDialog, {
    props: {
      musicSounds: [tavern],
      ambienceSounds: [rain],
      musicInScene: [],
      ambienceInScene: [],
      ...overrides,
    },
  })
}

describe('visionToVibeDialog', () => {
  beforeEach(() => {
    vi.mocked(openFileDialog).mockReset()
    vi.mocked(analyzeImageVibe).mockReset()
    vi.mocked(matchVibe).mockReset()
  })

  it('starts on the image picker with a third-party disclosure', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('[data-testid="vibe-pick-image"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Anthropic')
  })

  it('analyzes the chosen image and shows description, tags, and matches', async () => {
    vi.mocked(openFileDialog).mockResolvedValue('/tmp/map.png')
    vi.mocked(analyzeImageVibe).mockResolvedValue({ description: 'A cozy tavern.', tags: ['warm', 'tavern'] })
    vi.mocked(matchVibe).mockResolvedValue({ music: [{ sound: tavern, score: 2 }], ambience: [] })
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="vibe-pick-image"]').trigger('click')
    await flushPromises()
    expect(analyzeImageVibe).toHaveBeenCalledWith('/tmp/map.png')
    expect(matchVibe).toHaveBeenCalledWith(['warm', 'tavern'])
    expect(wrapper.text()).toContain('A cozy tavern.')
    expect(wrapper.findAll('.vibe-tag').map(t => t.text())).toEqual(['warm', 'tavern'])
    expect(wrapper.find('[data-testid="vibe-music-matches"]').text()).toContain('TAVERN')
  })

  it('emits add for a single match without touching the others', async () => {
    vi.mocked(openFileDialog).mockResolvedValue('/tmp/map.png')
    vi.mocked(analyzeImageVibe).mockResolvedValue({ description: 'Storm.', tags: ['storm'] })
    vi.mocked(matchVibe).mockResolvedValue({ music: [], ambience: [{ sound: rain, score: 1 }] })
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="vibe-pick-image"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="vibe-ambience-matches"] .btn-add-match').trigger('click')
    expect(wrapper.emitted('add')).toEqual([['ambience', rain]])
  })

  it('marks matches that are already in the scene', async () => {
    vi.mocked(openFileDialog).mockResolvedValue('/tmp/map.png')
    vi.mocked(analyzeImageVibe).mockResolvedValue({ description: 'Storm.', tags: ['storm'] })
    vi.mocked(matchVibe).mockResolvedValue({ music: [], ambience: [{ sound: rain, score: 1 }] })
    const wrapper = mountDialog({ ambienceInScene: ['rain'] })
    await wrapper.find('[data-testid="vibe-pick-image"]').trigger('click')
    await flushPromises()
    const btn = wrapper.find<HTMLButtonElement>('[data-testid="vibe-ambience-matches"] .btn-add-match')
    expect(btn.element.disabled).toBe(true)
    expect(btn.text()).toContain('Added')
  })

  it('explains the tagging gap when a category has no tagged sounds', async () => {
    vi.mocked(openFileDialog).mockResolvedValue('/tmp/map.png')
    vi.mocked(analyzeImageVibe).mockResolvedValue({ description: 'Storm.', tags: ['storm'] })
    vi.mocked(matchVibe).mockResolvedValue({ music: [], ambience: [] })
    const wrapper = mountDialog({ musicSounds: [sound('untagged', 'music')], ambienceSounds: [] })
    await wrapper.find('[data-testid="vibe-pick-image"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="vibe-music-empty"]').text()).toMatch(/tag your/i)
    expect(wrapper.find('[data-testid="vibe-ambience-empty"]').text()).toMatch(/tag your/i)
  })

  it('says when tagged sounds simply did not match', async () => {
    vi.mocked(openFileDialog).mockResolvedValue('/tmp/map.png')
    vi.mocked(analyzeImageVibe).mockResolvedValue({ description: 'Storm.', tags: ['storm'] })
    vi.mocked(matchVibe).mockResolvedValue({ music: [], ambience: [] })
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="vibe-pick-image"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="vibe-music-empty"]').text()).toMatch(/no music matched/i)
  })

  it('shows the error and returns to the picker when analysis fails', async () => {
    vi.mocked(openFileDialog).mockResolvedValue('/tmp/map.png')
    vi.mocked(analyzeImageVibe).mockRejectedValue(new Error('rate limited'))
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="vibe-pick-image"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.vibe-error').text()).toContain('rate limited')
    expect(wrapper.find('[data-testid="vibe-pick-image"]').exists()).toBe(true)
  })

  it('does nothing when the file dialog is cancelled', async () => {
    vi.mocked(openFileDialog).mockResolvedValue(null)
    const wrapper = mountDialog()
    await wrapper.find('[data-testid="vibe-pick-image"]').trigger('click')
    await flushPromises()
    expect(analyzeImageVibe).not.toHaveBeenCalled()
  })

  it('emits close on Escape', async () => {
    const wrapper = mountDialog()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('emits close from the close button', async () => {
    const wrapper = mountDialog()
    await wrapper.find('.btn-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
