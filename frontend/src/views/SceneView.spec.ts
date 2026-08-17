import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
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
  openFileDialog: vi.fn().mockResolvedValue(null),
  saveFileDialog: vi.fn().mockResolvedValue(null),
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
