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

const UNCONFIGURED_VISION = {
  provider: 'claude' as const,
  enabled: false,
  configured: false,
  claude: { keyConfigured: false, configured: false },
  openaiCompatible: { keyConfigured: false, configured: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' },
}

vi.mock('@/api/config', () => ({
  fetchVisionConfig: vi.fn().mockResolvedValue({
    provider: 'claude',
    enabled: false,
    configured: false,
    claude: { keyConfigured: false, configured: false },
    openaiCompatible: { keyConfigured: false, configured: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' },
  }),
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

describe('sceneView — compact layout now-playing summary', () => {
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

  it('shows "Nothing playing" while the scene is idle', async () => {
    const wrapper = await mountScene()
    expect(wrapper.find('.now-playing-line').text()).toBe('Nothing playing')
  })

  it('counts playing ambience once the scene plays locally', async () => {
    const wrapper = await mountScene()
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()
    expect(wrapper.find('.now-playing-line').text()).toContain('1 ambience')
  })

  it('names the currently playing music track', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValueOnce([{ id: 'm1', name: 'Tavern Theme', filename: 'tavern.mp3' }])
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValueOnce({
      ...JSON.parse(JSON.stringify(scene)),
      music: [{ soundId: 'm1', soundName: 'Tavern Theme', volume: 80, loop: false }],
    })
    const wrapper = await mountScene()
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()
    expect(wrapper.find('.now-playing-line').text()).toContain('Tavern Theme')
    expect(wrapper.find('.now-playing-line').text()).toContain('1 ambience')
  })

  it('shows "Scene playing" (never "Nothing playing") while Stop is still the active action, even after a track ends on its own', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValueOnce([{ id: 'm1', name: 'Tavern Theme', filename: 'tavern.mp3' }])
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValueOnce({
      id: 's1',
      name: 'Storm',
      ambience: [],
      music: [{ soundId: 'm1', soundName: 'Tavern Theme', volume: 80, loop: false }],
      effects: [],
    })
    const playSpy = vi.spyOn(mediaProto, 'play').mockImplementation(function (this: HTMLMediaElement) {
      queueMicrotask(() => this.onended?.(new Event('ended')))
      return Promise.resolve()
    })
    const wrapper = await mountScene()
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()

    // The track already ended (onended cleared playingMusicId), but the scene
    // is still "started" — Stop is still the right button, so the summary
    // line must not claim nothing is playing.
    expect(wrapper.find('.btn-stop-scene').exists()).toBe(true)
    expect(wrapper.find('.now-playing-line').text()).toBe('Scene playing')

    playSpy.mockRestore()
  })

  it('stops reporting playback once the scene is stopped', async () => {
    const wrapper = await mountScene()
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()
    await wrapper.find('.btn-stop-scene').trigger('click')
    await flushPromises()
    expect(wrapper.find('.now-playing-line').text()).toBe('Nothing playing')
  })
})

describe('sceneView — Vision to Vibe entry point', () => {
  beforeEach(async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue(JSON.parse(JSON.stringify(scene)))
    vi.mocked(fetchVisionConfig).mockReset()
  })

  it('is hidden when neither the provider is configured nor the toggle is set', async () => {
    vi.mocked(fetchVisionConfig).mockResolvedValue(UNCONFIGURED_VISION)
    const wrapper = await mountScene()
    expect(wrapper.find('[data-testid="vision-to-vibe-open"]').exists()).toBe(false)
  })

  it('is hidden when the provider is configured but the toggle is off', async () => {
    vi.mocked(fetchVisionConfig).mockResolvedValue({
      ...UNCONFIGURED_VISION,
      configured: true,
      claude: { keyConfigured: true, configured: true },
    })
    const wrapper = await mountScene()
    expect(wrapper.find('[data-testid="vision-to-vibe-open"]').exists()).toBe(false)
  })

  it('is hidden when the toggle is on but the provider is not configured', async () => {
    vi.mocked(fetchVisionConfig).mockResolvedValue({ ...UNCONFIGURED_VISION, enabled: true })
    const wrapper = await mountScene()
    expect(wrapper.find('[data-testid="vision-to-vibe-open"]').exists()).toBe(false)
  })

  it('is shown when the provider is configured and the toggle is set, and opens the dialog', async () => {
    vi.mocked(fetchVisionConfig).mockResolvedValue({
      ...UNCONFIGURED_VISION,
      enabled: true,
      configured: true,
      claude: { keyConfigured: true, configured: true },
    })
    const wrapper = await mountScene()
    const button = wrapper.find('[data-testid="vision-to-vibe-open"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.find('[role="dialog"][aria-label="Vision to Vibe"]').exists()).toBe(true)
  })

  it('is shown when the OpenAI-compatible provider is configured via a custom Base URL, with no key', async () => {
    vi.mocked(fetchVisionConfig).mockResolvedValue({
      provider: 'openai-compatible',
      enabled: true,
      configured: true,
      claude: { keyConfigured: false, configured: false },
      openaiCompatible: { keyConfigured: false, configured: true, baseUrl: 'http://localhost:11434/v1', model: 'local-vision' },
    })
    const wrapper = await mountScene()
    expect(wrapper.find('[data-testid="vision-to-vibe-open"]').exists()).toBe(true)
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

  it('resets scene playback indicators (ambience, music, scenePlaying) when the voice channel is lost', async () => {
    const { stopAudioStream, stopEffectStream } = await import('@/api/audio-stream')
    const { wrapper, player } = await mountSceneJoined()

    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.scenePlaying).toBe(true)

    player.playerState = []
    await flushPromises()

    expect(player.scenePlaying).toBe(false)
    expect(stopEffectStream).toHaveBeenCalledWith('g1', 'ambience-amb-1')
    expect(stopAudioStream).toHaveBeenCalledWith('g1')
  })

  it('does not stop scene playback when the sidebar selection switches to a different, unjoined guild', async () => {
    const { stopAudioStream, stopEffectStream } = await import('@/api/audio-stream')
    const { wrapper, player } = await mountSceneJoined()

    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.scenePlaying).toBe(true)
    vi.mocked(stopAudioStream).mockClear()
    vi.mocked(stopEffectStream).mockClear()

    // g1 stays joined and playing; the GM just looks at a different, unjoined guild.
    player.guildId = 'g2'
    await flushPromises()

    expect(player.scenePlaying).toBe(true)
    expect(stopAudioStream).not.toHaveBeenCalled()
    expect(stopEffectStream).not.toHaveBeenCalled()
  })
})
