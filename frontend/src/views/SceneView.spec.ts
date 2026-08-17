import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fetchVisionConfig } from '@/api/config'
import SceneView from './SceneView.vue'

vi.mock('@/api/scenes', () => ({
  listScenes: vi.fn().mockResolvedValue([]),
  getScene: vi.fn(),
  saveScene: vi.fn().mockResolvedValue(undefined),
  deleteScene: vi.fn().mockResolvedValue(undefined),
  exportScene: vi.fn().mockResolvedValue(undefined),
  importScene: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/sounds', () => ({
  listAmbience: vi.fn().mockResolvedValue([{ id: 'amb-1', name: 'Rain', filename: 'rain.mp3' }]),
  listMusic: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([{ id: 'fx-1', name: 'Thunder', filename: 'thunder.mp3' }]),
  soundStreamUrl: vi.fn((type: string, id: string) => `hibiki://sound/${type}/${id}`),
}))

vi.mock('@/api/audio-stream', () => ({
  sendAudioChunk: vi.fn(),
  sendEffectChunk: vi.fn(),
  startAudioStream: vi.fn().mockResolvedValue(undefined),
  startEffectStream: vi.fn().mockResolvedValue(undefined),
  stopAudioStream: vi.fn().mockResolvedValue(undefined),
  stopEffectStream: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/config', () => ({
  fetchVisionConfig: vi.fn().mockResolvedValue({ apiKeyConfigured: false, enabled: false }),
  openFileDialog: vi.fn().mockResolvedValue(null),
  saveFileDialog: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/api/vision', () => ({
  analyzeImageVibe: vi.fn(),
  matchVibe: vi.fn(),
}))

vi.mock('@/audio/browser-audio-capture', () => ({
  captureFromAudioElement: vi.fn().mockResolvedValue({ stop: vi.fn() }),
}))

const scene = {
  id: 's1',
  name: 'Storm',
  ambience: [{ soundId: 'amb-1', soundName: 'Rain', volume: 80, enabled: true }],
  music: [],
  effects: [{ soundId: 'fx-1', soundName: 'Thunder' }],
}

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/scenes', name: 'scenes', component: SceneView },
    { path: '/scenes/:id', name: 'scene', component: SceneView },
    { path: '/media', name: 'media', component: () => Promise.resolve({ template: '<div>Media</div>' }) },
  ],
})

const mediaProto = HTMLMediaElement.prototype
const originalMedia = {
  load: mediaProto.load,
  play: mediaProto.play,
  pause: mediaProto.pause,
}

function stubMediaElement() {
  Object.defineProperty(mediaProto, 'load', {
    configurable: true,
    value(this: HTMLMediaElement) {
      queueMicrotask(() => this.dispatchEvent(new Event('canplaythrough')))
    },
  })
  Object.defineProperty(mediaProto, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) })
  Object.defineProperty(mediaProto, 'pause', { configurable: true, value: vi.fn() })
}

async function mountScene() {
  await router.push('/scenes/s1')
  await router.isReady()
  const wrapper = mount(SceneView, {
    global: {
      plugins: [createPinia(), router],
      stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
    },
  })
  await flushPromises()
  return wrapper
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('sceneView pulses', () => {
  beforeAll(stubMediaElement)

  beforeEach(async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue(JSON.parse(JSON.stringify(scene)))
  })

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  it('renders the scene without any pulses while idle', async () => {
    const wrapper = await mountScene()
    expect(wrapper.find('.detail-title').text()).toBe('Storm')
    expect(wrapper.find('.sound-card-ambience').classes()).not.toContain('pulse')
    expect(wrapper.find('.effect-card').classes()).not.toContain('pulse')
    expect(wrapper.find('.scene-playback-bar').classes()).not.toContain('pulse-flash')
  })

  it('flashes an effect card briefly when the effect fires', async () => {
    const wrapper = await mountScene()
    await wrapper.find('.effect-trigger').trigger('click')
    const card = wrapper.find('.effect-card')
    expect(card.classes()).toContain('pulse')
    expect(card.classes()).toContain('pulse-flash')
    await wait(650)
    expect(wrapper.find('.effect-card').classes()).not.toContain('pulse-flash')
  })

  it('breathes on looping ambience while the scene plays and flashes the playback bar on transition', async () => {
    const wrapper = await mountScene()
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sound-card-ambience').classes()).toContain('pulse')
    expect(wrapper.find('.sound-card-ambience').classes()).toContain('pulse-breathe')
    expect(wrapper.find('.scene-playback-bar').classes()).toContain('pulse-flash')

    await wrapper.find('.btn-stop-scene').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sound-card-ambience').classes()).not.toContain('pulse-breathe')
  })
})

describe('sceneView — Vision to Vibe entry point', () => {
  beforeEach(async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue(JSON.parse(JSON.stringify(scene)))
    vi.mocked(fetchVisionConfig).mockReset()
  })

  it('is hidden when neither key nor toggle is set', async () => {
    vi.mocked(fetchVisionConfig).mockResolvedValue({ apiKeyConfigured: false, enabled: false })
    const wrapper = await mountScene()
    expect(wrapper.find('[data-testid="vision-to-vibe-open"]').exists()).toBe(false)
  })

  it('is hidden when a key is set but the toggle is off', async () => {
    vi.mocked(fetchVisionConfig).mockResolvedValue({ apiKeyConfigured: true, enabled: false })
    const wrapper = await mountScene()
    expect(wrapper.find('[data-testid="vision-to-vibe-open"]').exists()).toBe(false)
  })

  it('is hidden when the toggle is on but no key is set', async () => {
    vi.mocked(fetchVisionConfig).mockResolvedValue({ apiKeyConfigured: false, enabled: true })
    const wrapper = await mountScene()
    expect(wrapper.find('[data-testid="vision-to-vibe-open"]').exists()).toBe(false)
  })

  it('is shown when both key and toggle are set, and opens the dialog', async () => {
    vi.mocked(fetchVisionConfig).mockResolvedValue({ apiKeyConfigured: true, enabled: true })
    const wrapper = await mountScene()
    const button = wrapper.find('[data-testid="vision-to-vibe-open"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.find('[role="dialog"][aria-label="Vision to Vibe"]').exists()).toBe(true)
  })

  it('stays hidden when the vision config cannot be loaded', async () => {
    vi.mocked(fetchVisionConfig).mockRejectedValue(new Error('offline'))
    const wrapper = await mountScene()
    expect(wrapper.find('[data-testid="vision-to-vibe-open"]').exists()).toBe(false)
  })
})
