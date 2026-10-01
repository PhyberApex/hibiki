import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fetchVisionConfig } from '@/api/config'
import { usePlayerStore } from '@/stores/player'
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
  listEffects: vi.fn().mockResolvedValue([
    { id: 'fx-1', name: 'Thunder', filename: 'thunder.mp3' },
    { id: 'fx-2', name: 'Door slam', filename: 'door.mp3' },
  ]),
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
  captureFromAudioElement: vi.fn().mockImplementation(() => Promise.resolve({ stop: vi.fn() })),
  releaseAudioElementContext: vi.fn(),
}))

const scene = {
  id: 's1',
  name: 'Storm',
  ambience: [{ soundId: 'amb-1', soundName: 'Rain', volume: 80, enabled: true }],
  music: [],
  effects: [
    { soundId: 'fx-1', soundName: 'Thunder' },
    { soundId: 'fx-2', soundName: 'Door slam' },
  ],
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

async function mountSceneJoined() {
  await router.push('/scenes/s1')
  await router.isReady()
  const pinia = createPinia()
  const wrapper = mount(SceneView, {
    global: {
      plugins: [pinia, router],
      stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
    },
  })
  const player = usePlayerStore(pinia)
  player.playerState = [
    { guildId: 'g1', connectedChannelId: 'c1', isIdle: true, track: null, source: 'live' as const },
  ]
  player.guildId = 'g1'
  await flushPromises()
  return { wrapper, player }
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

describe('sceneView — overlapping effects', () => {
  let audioInstances: HTMLAudioElement[] = []

  beforeAll(stubMediaElement)

  beforeEach(async () => {
    vi.clearAllMocks()
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue(JSON.parse(JSON.stringify(scene)))

    audioInstances = []
    const OriginalAudio = globalThis.Audio
    vi.stubGlobal('Audio', new Proxy(OriginalAudio, {
      construct(target, args) {
        const instance = Reflect.construct(target, args) as HTMLAudioElement
        // Give each element its own `pause` mock — spying on the shared
        // prototype-level stub would dedupe to a single spy across elements.
        Object.defineProperty(instance, 'pause', { configurable: true, value: vi.fn() })
        audioInstances.push(instance)
        return instance
      },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  it('layers two different effects without cutting either off (local preview)', async () => {
    const wrapper = await mountScene()
    audioInstances.length = 0
    const triggers = wrapper.findAll('.effect-trigger')
    await triggers[0].trigger('click')
    await triggers[1].trigger('click')

    expect(audioInstances).toHaveLength(2)
    expect(audioInstances[0].pause).not.toHaveBeenCalled()
    expect(audioInstances[1].pause).not.toHaveBeenCalled()
  })

  it('layers two instances when the same effect is triggered twice (local preview)', async () => {
    const wrapper = await mountScene()
    audioInstances.length = 0
    const trigger = wrapper.find('.effect-trigger')
    await trigger.trigger('click')
    await trigger.trigger('click')

    expect(audioInstances).toHaveLength(2)
    expect(audioInstances[0].pause).not.toHaveBeenCalled()
    expect(audioInstances[1].pause).not.toHaveBeenCalled()
  })

  it('fires the flash feedback on every trigger, even when layering', async () => {
    const wrapper = await mountScene()
    const trigger = wrapper.find('.effect-trigger')
    await trigger.trigger('click')
    await trigger.trigger('click')

    expect(wrapper.find('.effect-card').classes()).toContain('pulse-flash')
  })

  it('stops the oldest instance once a ninth is triggered', async () => {
    const wrapper = await mountScene()
    audioInstances.length = 0
    const trigger = wrapper.find('.effect-trigger')
    for (let i = 0; i < 8; i++)
      await trigger.trigger('click')
    expect(audioInstances).toHaveLength(8)
    const firstEight = [...audioInstances]

    await trigger.trigger('click')

    expect(audioInstances).toHaveLength(9)
    expect(firstEight[0].pause).toHaveBeenCalled()
    for (let i = 1; i < 8; i++)
      expect(firstEight[i].pause).not.toHaveBeenCalled()
  })

  it('layers two different effects on the Discord-streamed path without cutting either off', async () => {
    const { startEffectStream } = await import('@/api/audio-stream')
    const { wrapper } = await mountSceneJoined()
    audioInstances.length = 0
    const triggers = wrapper.findAll('.effect-trigger')
    await triggers[0].trigger('click')
    await flushPromises()
    await triggers[1].trigger('click')
    await flushPromises()

    expect(audioInstances).toHaveLength(2)
    expect(audioInstances[0].pause).not.toHaveBeenCalled()
    expect(audioInstances[1].pause).not.toHaveBeenCalled()
    const streamIds = vi.mocked(startEffectStream).mock.calls.map(call => call[1])
    expect(new Set(streamIds).size).toBe(2)
  })

  it('tears down the stream, capture session and audio context when an instance ends (Discord)', async () => {
    const { stopEffectStream } = await import('@/api/audio-stream')
    const { captureFromAudioElement, releaseAudioElementContext } = await import('@/audio/browser-audio-capture')
    const { wrapper } = await mountSceneJoined()
    audioInstances.length = 0
    const trigger = wrapper.find('.effect-trigger')
    await trigger.trigger('click')
    await flushPromises()

    expect(audioInstances).toHaveLength(1)
    const el = audioInstances[0]
    const sess = await vi.mocked(captureFromAudioElement).mock.results[0].value

    el.dispatchEvent(new Event('ended'))

    expect(sess.stop).toHaveBeenCalled()
    expect(releaseAudioElementContext).toHaveBeenCalledWith(el)
    expect(stopEffectStream).toHaveBeenCalledWith('g1', 'effect-1')
  })

  it('stops all running effect instances when the scene stops', async () => {
    const { stopEffectStream } = await import('@/api/audio-stream')
    const { wrapper, player } = await mountSceneJoined()
    const trigger = wrapper.find('.effect-trigger')
    await trigger.trigger('click')
    await flushPromises()

    player.scenePlaying = true
    await flushPromises()
    await wrapper.find('.btn-stop-scene').trigger('click')

    expect(stopEffectStream).toHaveBeenCalledWith('g1', 'effect-1')
  })

  it('stops all running effect instances when the voice channel is left', async () => {
    const { stopEffectStream } = await import('@/api/audio-stream')
    const { wrapper, player } = await mountSceneJoined()
    const trigger = wrapper.find('.effect-trigger')
    await trigger.trigger('click')
    await flushPromises()

    player.playerState = []
    await flushPromises()

    expect(stopEffectStream).toHaveBeenCalledWith('g1', 'effect-1')
  })
})
