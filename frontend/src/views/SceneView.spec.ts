import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fetchSceneFadeLength, fetchVisionConfig, LOCAL_TARGET_ID } from '@/api/config'
import { usePlayerStore } from '@/stores/player'
import { useToastStore } from '@/stores/toast'
import SceneView from './SceneView.vue'

vi.mock('@/api/scenes', () => ({
  listScenes: vi.fn().mockResolvedValue([]),
  getScene: vi.fn(),
  saveScene: vi.fn().mockResolvedValue(undefined),
  deleteScene: vi.fn().mockResolvedValue(undefined),
  moveScene: vi.fn().mockResolvedValue(undefined),
  exportScene: vi.fn().mockResolvedValue(undefined),
  importScene: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/sounds', () => ({
  listAmbience: vi.fn().mockResolvedValue([
    { id: 'amb-1', name: 'Rain', filename: 'rain.mp3' },
  ]),
  listMusic: vi.fn().mockResolvedValue([]),
  listEffects: vi.fn().mockResolvedValue([
    { id: 'fx-1', name: 'Thunder', filename: 'thunder.mp3' },
    { id: 'fx-2', name: 'Door slam', filename: 'door.mp3' },
  ]),
  soundStreamUrl: vi.fn((type: string, id: string) => `hibiki://sound/${type}/${id}`),
  // Defaults every track to the renderer fallback (ADR-0003); backend-path
  // tests override this per-call to exercise `playMusic`/`stopMusic`.
  canDecode: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/api/audio-stream', () => ({
  sendAudioChunk: vi.fn(),
  sendEffectChunk: vi.fn(),
  startAudioStream: vi.fn().mockResolvedValue(undefined),
  startEffectStream: vi.fn().mockResolvedValue(undefined),
  stopAudioStream: vi.fn().mockResolvedValue(undefined),
  stopEffectStream: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/player')>()
  return {
    ...actual,
    playMusic: vi.fn().mockResolvedValue(undefined),
    stopMusic: vi.fn().mockResolvedValue(undefined),
    setMusicVolume: vi.fn().mockResolvedValue(undefined),
    playAmbience: vi.fn().mockResolvedValue(undefined),
    stopAmbience: vi.fn().mockResolvedValue(undefined),
    setAmbienceVolume: vi.fn().mockResolvedValue(undefined),
    playEffect: vi.fn().mockResolvedValue(undefined),
    stopEffects: vi.fn().mockResolvedValue(undefined),
    stopEffect: vi.fn().mockResolvedValue(undefined),
    warmEffects: vi.fn().mockResolvedValue({
      warmed: 0,
      skipped: 0,
      oversize: 0,
      failed: 0,
    }),
  }
})

const UNCONFIGURED_VISION = {
  provider: 'claude' as const,
  enabled: false,
  configured: false,
  claude: { keyConfigured: false, configured: false, encrypted: true },
  openaiCompatible: {
    keyConfigured: false,
    configured: false,
    encrypted: true,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6-astra',
  },
}

vi.mock('@/api/config', () => ({
  fetchVisionConfig: vi.fn().mockResolvedValue({
    provider: 'claude',
    enabled: false,
    configured: false,
    claude: { keyConfigured: false, configured: false, encrypted: true },
    openaiCompatible: {
      keyConfigured: false,
      configured: false,
      encrypted: true,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-6-astra',
    },
  }),
  openFileDialog: vi.fn().mockResolvedValue(null),
  saveFileDialog: vi.fn().mockResolvedValue(null),
  // 0.1s rather than the real 3s default, so crossfade tests can wait for a
  // fade to actually complete with a short, real setTimeout-based `wait()`.
  fetchSceneFadeLength: vi.fn().mockResolvedValue(0.1),
  fetchMasterVolume: vi.fn().mockResolvedValue(80),
  updateMasterVolume: vi.fn().mockResolvedValue(undefined),
  fetchActiveOutputTarget: vi.fn().mockResolvedValue('discord'),
  updateActiveOutputTarget: vi.fn().mockResolvedValue(undefined),
  LOCAL_TARGET_ID: 'local',
}))

vi.mock('@/api/vision', () => ({
  analyzeImageVibe: vi.fn(),
  matchVibe: vi.fn(),
}))

vi.mock('@/audio/browser-audio-capture', () => ({
  captureFromAudioElement: vi.fn().mockImplementation(() => Promise.resolve({
    stop: vi.fn(),
  })),
  releaseAudioElementContext: vi.fn(),
}))

const scene = {
  id: 's1',
  name: 'Storm',
  ambience: [
    {
      soundId: 'amb-1',
      soundName: 'Rain',
      volume: 80,
      enabled: true,
    },
  ],
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
    {
      path: '/media',
      name: 'media',
      component: () => Promise.resolve({ template: '<div>Media</div>' }),
    },
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
  Object.defineProperty(mediaProto, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  Object.defineProperty(mediaProto, 'pause', {
    configurable: true,
    value: vi.fn(),
  })
}

async function mountScene() {
  await router.push('/scenes/s1')
  await router.isReady()
  const pinia = createPinia()
  const wrapper = mount(SceneView, {
    global: {
      plugins: [pinia, router],
      stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
    },
  })
  await flushPromises()
  // The Local Target needs no voice connection.
  usePlayerStore(pinia).activeTarget = 'local'
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
    {
      guildId: 'g1',
      connectedChannelId: 'c1',
      isIdle: true,
      track: null,
      source: 'live' as const,
    },
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
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sound-card-ambience').classes()).toContain('pulse')
    expect(wrapper.find('.sound-card-ambience').classes()).toContain('pulse-breathe')
    expect(wrapper.find('.scene-playback-bar').classes()).toContain('pulse-flash')

    await wrapper.find('.btn-stop-scene').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sound-card-ambience').classes()).not.toContain('pulse-breathe')
  })
})

describe('sceneView — Scene import', () => {
  beforeAll(stubMediaElement)

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  it('reloads the sound library after importing a bundled Scene so its sounds are not flagged missing', async () => {
    const { importScene, getScene, listScenes } = await import('@/api/scenes')
    const { listMusic, listAmbience, listEffects } = await import('@/api/sounds')
    const { openFileDialog } = await import('@/api/config')
    const imported = {
      id: 's2',
      name: 'Imported',
      music: [
        {
          soundId: 'bundled-track',
          soundName: 'Bundled Track',
          volume: 60,
          loop: true,
        },
      ],
      ambience: [],
      effects: [],
    }
    vi.mocked(openFileDialog).mockResolvedValueOnce('/tmp/imported.hibiki.zip')
    vi.mocked(importScene).mockResolvedValueOnce(imported as never)
    vi.mocked(listScenes).mockResolvedValueOnce([imported as never])
    vi.mocked(getScene).mockResolvedValueOnce(JSON.parse(JSON.stringify(imported)))
    vi.mocked(listMusic).mockResolvedValueOnce([
      { id: 'bundled-track', name: 'Bundled Track', filename: 'bundled-track.mp3' } as never,
    ])

    await router.push('/scenes')
    await router.isReady()
    const wrapper = mount(SceneView, {
      global: {
        plugins: [
          createPinia(),
          router,
        ],
        stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
      },
    })
    await flushPromises()
    const callsBefore = { music: vi.mocked(listMusic).mock.calls.length, ambience: vi.mocked(listAmbience).mock.calls.length, effects: vi.mocked(listEffects).mock.calls.length }

    const importButton = wrapper.findAll('button').find(b => b.text() === 'Import')
    await importButton!.trigger('click')
    await flushPromises()

    expect(vi.mocked(listMusic).mock.calls.length).toBe(callsBefore.music + 1)
    expect(vi.mocked(listAmbience).mock.calls.length).toBe(callsBefore.ambience + 1)
    expect(vi.mocked(listEffects).mock.calls.length).toBe(callsBefore.effects + 1)
    expect(wrapper.find('.sound-missing-badge').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('sceneView — Scene list refresh', () => {
  beforeAll(stubMediaElement)

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  it('reloads the Scene list when navigating back from an edited Scene so its counts are not stale', async () => {
    const { getScene, listScenes } = await import('@/api/scenes')
    const empty = {
      id: 's3',
      name: 'Fresh',
      ambience: [],
      music: [],
      effects: [],
    }
    const withTrack = {
      ...empty,
      music: [
        {
          soundId: 'amb-1',
          soundName: 'Rain',
          volume: 80,
          loop: true,
        },
      ],
    }
    vi.mocked(listScenes).mockResolvedValue([empty as never])
    vi.mocked(getScene).mockResolvedValue(JSON.parse(JSON.stringify(withTrack)))

    await router.push('/scenes/s3')
    await router.isReady()
    const wrapper = mount(SceneView, {
      global: {
        plugins: [
          createPinia(),
          router,
        ],
        stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
      },
    })
    await flushPromises()

    vi.mocked(listScenes).mockResolvedValue([withTrack as never])
    await router.push('/scenes')
    await flushPromises()

    expect(wrapper.find('.count-badge-empty').exists()).toBe(false)
    expect(wrapper.find('.count-badge-music').text()).toBe('1 music')
    wrapper.unmount()
    vi.mocked(listScenes).mockResolvedValue([])
  })
})

describe('sceneView — master volume persistence', () => {
  beforeAll(stubMediaElement)

  beforeEach(async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue(JSON.parse(JSON.stringify(scene)))
    const { fetchMasterVolume, updateMasterVolume } = await import('@/api/config')
    vi.mocked(fetchMasterVolume).mockReset().mockResolvedValue(80)
    vi.mocked(updateMasterVolume).mockReset().mockResolvedValue(undefined)
  })

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  it('loads the persisted master volume on mount instead of always starting at the default', async () => {
    const { fetchMasterVolume } = await import('@/api/config')
    vi.mocked(fetchMasterVolume).mockResolvedValue(42)

    const wrapper = await mountScene()

    const slider = wrapper.find<HTMLInputElement>('[aria-label="Global volume"]')
    expect(slider.element.value).toBe('42')
  })

  it('persists the master volume once the slider change settles, not on every drag tick', async () => {
    const { updateMasterVolume } = await import('@/api/config')
    const wrapper = await mountScene()

    const slider = wrapper.find<HTMLInputElement>('[aria-label="Global volume"]')
    slider.element.value = '55'
    await slider.trigger('input')
    expect(updateMasterVolume).not.toHaveBeenCalled()

    await slider.trigger('change')
    expect(updateMasterVolume).toHaveBeenCalledWith(expect.any(String), 55)
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
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(wrapper.find('.now-playing-line').text()).toContain('1 ambience')
  })

  it('names the currently playing music track', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValueOnce([
      { id: 'm1', name: 'Tavern Theme', filename: 'tavern.mp3' },
    ])
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValueOnce({
      ...JSON.parse(JSON.stringify(scene)),
      music: [
        {
          soundId: 'm1',
          soundName: 'Tavern Theme',
          volume: 80,
          loop: false,
        },
      ],
    })
    const wrapper = await mountScene()
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(wrapper.find('.now-playing-line').text()).toContain('Tavern Theme')
    expect(wrapper.find('.now-playing-line').text()).toContain('1 ambience')
  })

  it('shows elapsed / total on the playing Music track when its duration is known (#695)', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValueOnce([
      {
        id: 'm1',
        name: 'Tavern Theme',
        filename: 'tavern.mp3',
        category: 'music',
        durationMs: 184_000,
      },
      {
        id: 'm2',
        name: 'Unknown Length',
        filename: 'odd.mp3',
        category: 'music',
      },
    ])
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValueOnce({
      ...JSON.parse(JSON.stringify(scene)),
      music: [
        {
          soundId: 'm1',
          soundName: 'Tavern Theme',
          volume: 80,
          loop: false,
        },
        {
          soundId: 'm2',
          soundName: 'Unknown Length',
          volume: 80,
          loop: false,
        },
      ],
    })
    const wrapper = await mountScene()
    expect(wrapper.find('.music-timer').exists()).toBe(false)
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    const timers = wrapper.findAll('.music-timer')
    expect(timers).toHaveLength(1)
    expect(timers[0]!.text()).toBe('0:00 / 3:04')
    expect(wrapper.find('.music-progress-fill').exists()).toBe(true)

    await wrapper.find('button[aria-label="Stop music"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.music-timer').exists()).toBe(false)
  })

  it('shows "Scene playing" (never "Nothing playing") while Stop is still the active action, even after a track ends on its own', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockResolvedValueOnce([
      { id: 'm1', name: 'Tavern Theme', filename: 'tavern.mp3' },
    ])
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValueOnce({
      id: 's1',
      name: 'Storm',
      ambience: [],
      music: [
        {
          soundId: 'm1',
          soundName: 'Tavern Theme',
          volume: 80,
          loop: false,
        },
      ],
      effects: [],
    })
    const playSpy = vi.spyOn(mediaProto, 'play').mockImplementation(function (this: HTMLMediaElement) {
      queueMicrotask(() => this.onended?.(new Event('ended')))
      return Promise.resolve()
    })
    const wrapper = await mountScene()
    await wrapper.find('.btn-play-scene').trigger('click')
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
    await wrapper.find('.btn-play-scene').trigger('click')
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
      claude: { keyConfigured: true, configured: true, encrypted: true },
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
      claude: { keyConfigured: true, configured: true, encrypted: true },
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
      claude: { keyConfigured: false, configured: false, encrypted: true },
      openaiCompatible: {
        keyConfigured: false,
        configured: true,
        encrypted: true,
        baseUrl: 'http://localhost:11434/v1',
        model: 'local-vision',
      },
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
        Object.defineProperty(instance, 'pause', {
          configurable: true,
          value: vi.fn(),
        })
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

    player.setPlayingScene('s1', 'discord')
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
    // This scene has no Music, so no music channel was ever Discord-sourced
    // — stopMusic() has nothing to tear down and makes no IPC call for it.
    expect(stopAudioStream).not.toHaveBeenCalled()
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

  it('stops ambience toggled individually (no Play pressed) when the voice channel is left', async () => {
    const { stopEffectStream } = await import('@/api/audio-stream')
    const { wrapper, player } = await mountSceneJoined()

    // The fixture starts this ambience item already enabled, so flip it off
    // then back on to actually fire the toggle handler (and thus playAmbience).
    const checkbox = wrapper.find('input[type="checkbox"]')
    await checkbox.setValue(false)
    await checkbox.setValue(true)
    await flushPromises()
    expect(player.playingSceneId).toBeNull()

    player.playerState = []
    await flushPromises()

    expect(stopEffectStream).toHaveBeenCalledWith('g1', 'ambience-amb-1')
  })
})

describe('sceneView — backend-decoded Effects (ADR-0003)', () => {
  beforeAll(stubMediaElement)

  beforeEach(async () => {
    const { canDecode } = await import('@/api/sounds')
    vi.mocked(canDecode).mockImplementation(async (_type: string, _id: string) => _type === 'effects')
  })

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  it('plays via the backend and sends no audio:effectChunk IPC when the sound can decode', async () => {
    const { startEffectStream, sendEffectChunk } = await import('@/api/audio-stream')
    const { playEffect: playBackendEffect } = await import('@/api/player')
    const { wrapper } = await mountSceneJoined()

    await wrapper.find('.effect-trigger').trigger('click')
    await flushPromises()

    expect(playBackendEffect).toHaveBeenCalledWith('g1', 'fx-1', {
      volume: expect.closeTo(64),
    })
    expect(startEffectStream).not.toHaveBeenCalled()
    expect(sendEffectChunk).not.toHaveBeenCalled()
  })

  it('fires the flash feedback on a backend-decoded trigger', async () => {
    const { wrapper } = await mountSceneJoined()

    await wrapper.find('.effect-trigger').trigger('click')
    await flushPromises()

    expect(wrapper.find('.effect-card').classes()).toContain('pulse-flash')
  })

  it('layers multiple backend-decoded instances of the same Effect, one call per trigger', async () => {
    const { playEffect: playBackendEffect } = await import('@/api/player')
    const { wrapper } = await mountSceneJoined()
    const trigger = wrapper.find('.effect-trigger')

    await trigger.trigger('click')
    await flushPromises()
    await trigger.trigger('click')
    await flushPromises()

    expect(playBackendEffect).toHaveBeenCalledTimes(2)
  })

  it('falls back to the renderer path for a non-decodable (e.g. m4a) Effect', async () => {
    const { canDecode } = await import('@/api/sounds')
    vi.mocked(canDecode).mockResolvedValue(false)
    const { startEffectStream } = await import('@/api/audio-stream')
    const { playEffect: playBackendEffect } = await import('@/api/player')
    const { wrapper } = await mountSceneJoined()

    await wrapper.find('.effect-trigger').trigger('click')
    await flushPromises()

    expect(playBackendEffect).not.toHaveBeenCalled()
    expect(startEffectStream).toHaveBeenCalled()
  })

  it('stops backend-decoded Effect instances via the backend when the scene stops', async () => {
    const { stopEffects: stopBackendEffects } = await import('@/api/player')
    const { wrapper, player } = await mountSceneJoined()

    await wrapper.find('.effect-trigger').trigger('click')
    await flushPromises()
    vi.mocked(stopBackendEffects).mockClear()

    player.setPlayingScene('s1', 'discord')
    await flushPromises()
    await wrapper.find('.btn-stop-scene').trigger('click')

    expect(stopBackendEffects).toHaveBeenCalledWith('g1')
  })

  it('stops backend-decoded Effect instances via the backend when the voice channel is left', async () => {
    const { stopEffects: stopBackendEffects } = await import('@/api/player')
    const { wrapper, player } = await mountSceneJoined()

    await wrapper.find('.effect-trigger').trigger('click')
    await flushPromises()
    vi.mocked(stopBackendEffects).mockClear()

    player.playerState = []
    await flushPromises()

    expect(stopBackendEffects).toHaveBeenCalledWith('g1')
  })
})

describe('sceneView — Effect Instance indicator (#509)', () => {
  let audioInstances: HTMLAudioElement[] = []
  const originalDuration = Object.getOwnPropertyDescriptor(mediaProto, 'duration')

  beforeAll(() => {
    stubMediaElement()
    // Local preview and the Discord-fallback path both read a known
    // duration off the `<audio>` element once it's loaded/playing (jsdom
    // itself never reports one) — fixed at 2s for every element here.
    Object.defineProperty(mediaProto, 'duration', {
      configurable: true,
      get: () => 2,
    })
  })

  beforeEach(async () => {
    // A preceding describe block overrides `canDecode` to resolve true for
    // Effects (the backend-decoded path) and never resets it — default back
    // to the renderer fallback here so the Discord-fallback test actually
    // exercises that path rather than leaking the prior describe's mock.
    const { canDecode } = await import('@/api/sounds')
    vi.mocked(canDecode).mockResolvedValue(false)
    audioInstances = []
    const OriginalAudio = globalThis.Audio
    vi.stubGlobal('Audio', new Proxy(OriginalAudio, {
      construct(target, args) {
        const instance = Reflect.construct(target, args) as HTMLAudioElement
        Object.defineProperty(instance, 'pause', {
          configurable: true,
          value: vi.fn(),
        })
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
    if (originalDuration)
      Object.defineProperty(mediaProto, 'duration', originalDuration)
  })

  it('shows a progress fill and m:ss / m:ss timer for a local-preview instance, and Stop clears it immediately', async () => {
    const wrapper = await mountScene()
    audioInstances.length = 0 // discard the two music-channel elements created on mount

    await wrapper.find('.effect-trigger').trigger('click')
    await flushPromises()

    expect(wrapper.find('.effect-progress-fill').exists()).toBe(true)
    expect(wrapper.find('.effect-timer').text()).toBe('0:00 / 0:02')
    expect(wrapper.find('.effect-count-badge').exists()).toBe(false)

    await wrapper.find('.effect-stop').trigger('click')
    await flushPromises()

    expect(audioInstances[0].pause).toHaveBeenCalled()
    expect(wrapper.find('.effect-timer').exists()).toBe(false)
    expect(wrapper.find('.effect-stop').exists()).toBe(false)
  })

  it('shows a ×N badge once the same Effect has more than one active instance, decrementing as instances end', async () => {
    const wrapper = await mountScene()
    audioInstances.length = 0
    const trigger = wrapper.find('.effect-trigger')

    await trigger.trigger('click')
    await flushPromises()
    await trigger.trigger('click')
    await flushPromises()

    expect(wrapper.find('.effect-count-badge').text()).toBe('×2')

    audioInstances[0].dispatchEvent(new Event('ended'))
    await flushPromises()

    expect(wrapper.find('.effect-count-badge').exists()).toBe(false)
    expect(wrapper.find('.effect-timer').exists()).toBe(true)
  })

  it('shows the indicator on the Discord-fallback path too', async () => {
    const { wrapper } = await mountSceneJoined()

    await wrapper.find('.effect-trigger').trigger('click')
    await flushPromises()

    expect(wrapper.find('.effect-timer').text()).toBe('0:00 / 0:02')
  })

  it('the Stop control is a real button with an aria-label naming the sound', async () => {
    const wrapper = await mountScene()

    await wrapper.find('.effect-trigger').trigger('click')
    await flushPromises()

    const stopButton = wrapper.find('.effect-stop')
    expect(stopButton.element.tagName).toBe('BUTTON')
    expect(stopButton.attributes('aria-label')).toBe('Stop Thunder')
  })

  it('reflects a backend-decoded instance synced from playerState, and Stop calls the per-instance backend API', async () => {
    const { stopEffect: stopBackendEffect } = await import('@/api/player')
    const { wrapper, player } = await mountSceneJoined()

    player.playerState = [
      {
        guildId: 'g1',
        connectedChannelId: 'c1',
        isIdle: false,
        track: null,
        source: 'live',
        effects: [
          {
            instanceId: 'backend-effect:1',
            soundId: 'fx-1',
            startedAt: new Date().toISOString(),
            durationMs: 2000,
          },
        ],
      },
    ]
    await flushPromises()

    expect(wrapper.find('.effect-timer').text()).toBe('0:00 / 0:02')

    await wrapper.find('.effect-stop').trigger('click')
    await flushPromises()

    expect(stopBackendEffect).toHaveBeenCalledWith('g1', 'backend-effect:1')
    expect(wrapper.find('.effect-timer').exists()).toBe(false)
  })
})

describe('sceneView — Playing Scene outlives the open Scene', () => {
  beforeAll(stubMediaElement)

  const sceneB = {
    id: 's2',
    name: 'Tavern',
    ambience: [],
    music: [],
    effects: [],
  }

  beforeEach(async () => {
    const { getScene, listScenes } = await import('@/api/scenes')
    vi.mocked(getScene).mockImplementation(async (id: string) => {
      if (id === 's1')
        return JSON.parse(JSON.stringify(scene))
      if (id === 's2')
        return JSON.parse(JSON.stringify(sceneB))
      return null
    })
    vi.mocked(listScenes).mockResolvedValue([
      JSON.parse(JSON.stringify(scene)),
      JSON.parse(JSON.stringify(sceneB)),
    ])
  })

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  async function mountSceneWithPlayer(target: 'local' | 'discord' = 'discord') {
    await router.push('/scenes/s1')
    await router.isReady()
    const pinia = createPinia()
    const wrapper = mount(SceneView, {
      global: {
        plugins: [pinia, router],
        stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
      },
    })
    await flushPromises()
    const player = usePlayerStore(pinia)
    player.activeTarget = target
    await flushPromises()
    return { wrapper, player }
  }

  it('does not start playback just from opening a Scene', async () => {
    const { wrapper, player } = await mountSceneWithPlayer()
    expect(player.playingSceneId).toBeNull()
    expect(wrapper.find('.sound-card-ambience').classes()).not.toContain('pulse-breathe')
  })

  it('stops ambience toggled individually (no Play pressed) when navigating back to the Scene list', async () => {
    const { stopEffectStream } = await import('@/api/audio-stream')
    const { wrapper, player } = await mountSceneWithPlayer()
    player.playerState = [
      {
        guildId: 'g1',
        connectedChannelId: 'c1',
        isIdle: true,
        track: null,
        source: 'live' as const,
      },
    ]
    player.guildId = 'g1'
    await flushPromises()

    // The fixture starts this ambience item already enabled, so flip it off
    // then back on to actually fire the toggle handler (and thus playAmbience).
    const checkbox = wrapper.find('input[type="checkbox"]')
    await checkbox.setValue(false)
    await checkbox.setValue(true)
    await flushPromises()
    expect(player.playingSceneId).toBeNull()

    vi.mocked(stopEffectStream).mockClear()
    await router.push('/scenes')
    await flushPromises()

    expect(stopEffectStream).toHaveBeenCalledWith('g1', 'ambience-amb-1')
  })

  it('keeps Music and Ambience playing when navigating back to the Scene list (local preview)', async () => {
    const { wrapper, player } = await mountSceneWithPlayer('local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')
    expect(player.playingSceneMode).toBe(LOCAL_TARGET_ID)

    await router.push('/scenes')
    await flushPromises()

    expect(player.playingSceneId).toBe('s1')
    expect(player.playingSceneMode).toBe(LOCAL_TARGET_ID)
  })

  it('marks the playing Scene in the list and stops it from there', async () => {
    const { wrapper, player } = await mountSceneWithPlayer('local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()

    await router.push('/scenes')
    await flushPromises()

    const row = wrapper.findAll('.scene-list-row').find(r => r.text().includes('Storm'))
    expect(row).toBeTruthy()
    expect(row!.find('.playing-badge').exists()).toBe(true)

    await row!.find('.btn-stop-list').trigger('click')
    await flushPromises()

    expect(player.playingSceneId).toBeNull()
    expect(player.playingSceneMode).toBeNull()
  })

  it('shows the playing state and does not restart when re-opening the playing Scene', async () => {
    const { wrapper, player } = await mountSceneWithPlayer('local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    const playCallsAfterStart = vi.mocked(mediaProto.play).mock.calls.length

    await router.push('/scenes')
    await flushPromises()
    await router.push('/scenes/s1')
    await flushPromises()

    expect(player.playingSceneId).toBe('s1')
    expect(wrapper.find('.btn-stop-scene').exists()).toBe(true)
    expect(vi.mocked(mediaProto.play).mock.calls.length).toBe(playCallsAfterStart)
  })

  it('stops a local music track via the inline per-track Stop button after re-opening the playing Scene', async () => {
    const { listMusic } = await import('@/api/sounds')
    vi.mocked(listMusic).mockImplementation(async () => [
      { id: 'm1', name: 'Tavern Theme', filename: 'tavern.mp3' },
    ])
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockImplementation(async () => ({
      id: 's1',
      name: 'Storm',
      ambience: [],
      music: [
        {
          soundId: 'm1',
          soundName: 'Tavern Theme',
          volume: 80,
          loop: false,
        },
      ],
      effects: [],
    }))

    const { wrapper, player } = await mountSceneWithPlayer('local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneMode).toBe(LOCAL_TARGET_ID)

    // Re-opening the playing Scene must leave its controls working as before.
    await router.push('/scenes')
    await flushPromises()
    await router.push('/scenes/s1')
    await flushPromises()

    const stopButton = wrapper.find('.btn-icon-active')
    expect(stopButton.exists()).toBe(true)
    await stopButton.trigger('click')
    await flushPromises()

    expect(wrapper.find('.btn-icon-active').exists()).toBe(false)
  })

  it('crossfades to a different Scene instead of cutting to silence when opening it', async () => {
    const { wrapper, player } = await mountSceneWithPlayer('local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')

    await router.push('/scenes/s2')
    await flushPromises()

    // The new Scene becomes the Playing Scene immediately, in the same
    // mode — this is a crossfade, not a stop-then-silence.
    expect(wrapper.find('.detail-title').text()).toBe('Tavern')
    expect(player.playingSceneId).toBe('s2')
    expect(player.playingSceneMode).toBe(LOCAL_TARGET_ID)
    expect(wrapper.find('.btn-stop-scene').exists()).toBe(true)

    await wait(300)
    await flushPromises()

    // Once the fade completes, nothing from the old Scene is left running —
    // Tavern (s2) itself has no sounds, so the summary just says so.
    expect(wrapper.find('.now-playing-line').text()).toBe('Scene playing')
  })

  it('crossfades to a different Scene when opening it from the Scene list', async () => {
    const { wrapper, player } = await mountSceneWithPlayer('local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')

    await router.push('/scenes')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')

    await router.push('/scenes/s2')
    await flushPromises()

    expect(player.playingSceneId).toBe('s2')
    expect(player.playingSceneMode).toBe(LOCAL_TARGET_ID)
  })

  it('stops the playing Scene when it is deleted', async () => {
    vi.stubGlobal('confirm', () => true)
    const { deleteScene } = await import('@/api/scenes')
    const { wrapper, player } = await mountSceneWithPlayer('local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')

    await wrapper.find('.btn-danger').trigger('click')
    await flushPromises()

    expect(deleteScene).toHaveBeenCalledWith('s1')
    expect(player.playingSceneId).toBeNull()
    vi.unstubAllGlobals()
  })

  it('works the same for Discord streaming: survives the list, marks the row, stops from there', async () => {
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
      {
        guildId: 'g1',
        connectedChannelId: 'c1',
        isIdle: true,
        track: null,
        source: 'live' as const,
      },
    ]
    player.guildId = 'g1'
    await flushPromises()

    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')
    expect(player.playingSceneMode).toBe('g1')

    await router.push('/scenes')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')

    const row = wrapper.findAll('.scene-list-row').find(r => r.text().includes('Storm'))
    await row!.find('.btn-stop-list').trigger('click')
    await flushPromises()

    expect(player.playingSceneId).toBeNull()
  })
})

describe('sceneView — Scene Crossfade', () => {
  beforeAll(stubMediaElement)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  // A fresh router per test, rather than the module-level `router` shared by
  // every other describe block in this file — those earlier tests often
  // leave their own wrapper mounted (never unmounted) with a non-null
  // `playingSceneId`, still subscribed to the shared route. Since opening a
  // different Scene while one plays now has real side effects (crossfading,
  // not just an idempotent stop), those zombie wrappers would otherwise
  // react to this describe's route pushes too and pollute its assertions.
  function createTestRouter() {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/scenes', name: 'scenes', component: SceneView },
        { path: '/scenes/:id', name: 'scene', component: SceneView },
      ],
    })
  }

  async function mountAt(path: string, target: 'local' | 'discord' = 'discord') {
    const testRouter = createTestRouter()
    await testRouter.push(path)
    await testRouter.isReady()
    const pinia = createPinia()
    const wrapper = mount(SceneView, {
      global: {
        plugins: [pinia, testRouter],
        stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
      },
    })
    await flushPromises()
    const player = usePlayerStore(pinia)
    player.activeTarget = target
    await flushPromises()
    return { wrapper, player, router: testRouter }
  }

  const sceneX = {
    id: 'x1',
    name: 'Camp',
    ambience: [
      {
        soundId: 'amb-1',
        soundName: 'Rain',
        volume: 80,
        enabled: true,
      },
    ],
    music: [
      {
        soundId: 'm1',
        soundName: 'Track One',
        volume: 80,
        loop: false,
      },
    ],
    effects: [],
  }
  // amb-1 is shared with sceneX (at a different volume, to prove the glide),
  // amb-2 is new to this Scene, and the Music track differs entirely.
  const sceneY = {
    id: 'y1',
    name: 'Tavern',
    ambience: [
      {
        soundId: 'amb-1',
        soundName: 'Rain',
        volume: 40,
        enabled: true,
      },
      {
        soundId: 'amb-2',
        soundName: 'Wind',
        volume: 60,
        enabled: true,
      },
    ],
    music: [
      {
        soundId: 'm2',
        soundName: 'Track Two',
        volume: 80,
        loop: false,
      },
    ],
    effects: [],
  }
  const sceneZ = {
    id: 'z1',
    name: 'Silence',
    ambience: [],
    music: [],
    effects: [],
  }

  beforeEach(async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockImplementation(async (id: string) => {
      if (id === 'x1')
        return JSON.parse(JSON.stringify(sceneX))
      if (id === 'y1')
        return JSON.parse(JSON.stringify(sceneY))
      if (id === 'z1')
        return JSON.parse(JSON.stringify(sceneZ))
      return null
    })
    const { listAmbience, listMusic } = await import('@/api/sounds')
    vi.mocked(listAmbience).mockResolvedValue([
      { id: 'amb-1', name: 'Rain', filename: 'rain.mp3' },
      { id: 'amb-2', name: 'Wind', filename: 'wind.mp3' },
    ])
    vi.mocked(listMusic).mockResolvedValue([
      { id: 'm1', name: 'Track One', filename: 'one.mp3' },
      { id: 'm2', name: 'Track Two', filename: 'two.mp3' },
    ])
  })

  it('glides a shared Ambience sound to its new volume without restarting it', async () => {
    const audioInstances: HTMLAudioElement[] = []
    const OriginalAudio = globalThis.Audio
    vi.stubGlobal('Audio', new Proxy(OriginalAudio, {
      construct(target, args) {
        const instance = Reflect.construct(target, args) as HTMLAudioElement
        Object.defineProperty(instance, 'pause', {
          configurable: true,
          value: vi.fn(),
        })
        audioInstances.push(instance)
        return instance
      },
    }))

    const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1', 'local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('x1')
    const instancesAfterX = audioInstances.length

    await testRouter.push('/scenes/y1')
    await flushPromises()

    // amb-1 is shared — it reuses its existing element (no restart). Only
    // amb-2, new to this Scene, needs a fresh one; the incoming Music track
    // reuses the second long-lived music channel created at mount.
    expect(audioInstances.length).toBe(instancesAfterX + 1)

    await wait(300)
    await flushPromises()

    expect(wrapper.find('.now-playing-line').text()).toContain('2 ambience')
  })

  it('performs an immediate cut with no lingering old-Scene sounds when the fade length is 0', async () => {
    vi.mocked(fetchSceneFadeLength).mockResolvedValueOnce(0)
    const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1', 'local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()

    await testRouter.push('/scenes/z1')
    await flushPromises()

    expect(player.playingSceneId).toBe('z1')
    // z1 has no sounds of its own, and the cut was immediate — nothing from
    // x1 should still be reported as playing.
    expect(wrapper.find('.now-playing-line').text()).toBe('Scene playing')
  })

  it('ends with only the newest Scene playing after switching twice during a fade', async () => {
    const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1', 'local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()

    await testRouter.push('/scenes/y1')
    await flushPromises()
    // Before y1's fade finishes, switch again.
    await testRouter.push('/scenes/z1')
    await flushPromises()

    expect(player.playingSceneId).toBe('z1')

    await wait(400)
    await flushPromises()

    expect(wrapper.find('.now-playing-line').text()).toBe('Scene playing')
  })

  it('silences everything immediately when Stop is pressed during a fade', async () => {
    const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1', 'local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()

    await testRouter.push('/scenes/y1')
    await flushPromises()
    expect(player.playingSceneId).toBe('y1')

    await wrapper.find('.btn-stop-scene').trigger('click')
    await flushPromises()

    expect(player.playingSceneId).toBeNull()
    expect(wrapper.find('.now-playing-line').text()).toBe('Nothing playing')
  })

  it('streams both the outgoing and incoming Music tracks to Discord at once during the fade', async () => {
    const { startAudioStream, stopAudioStream } = await import('@/api/audio-stream')
    const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
    player.playerState = [
      {
        guildId: 'g1',
        connectedChannelId: 'c1',
        isIdle: true,
        track: null,
        source: 'live' as const,
      },
    ]
    player.guildId = 'g1'
    await flushPromises()

    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('x1')

    await testRouter.push('/scenes/y1')
    await flushPromises()

    const streamIds = vi.mocked(startAudioStream).mock.calls.map(call => call[2])
    expect(streamIds).toEqual(expect.arrayContaining(['music-a', 'music-b']))
    // Both channels are still streaming at this point — the outgoing one
    // (music-a) hasn't been torn down yet, mid-fade.
    expect(stopAudioStream).not.toHaveBeenCalledWith('g1', 'music-a')

    await wait(300)
    await flushPromises()

    // Once the fade completes, the outgoing stream is closed.
    expect(stopAudioStream).toHaveBeenCalledWith('g1', 'music-a')
  })

  describe('backend-decoded Music (ADR-0003)', () => {
    beforeEach(async () => {
      const { canDecode } = await import('@/api/sounds')
      vi.mocked(canDecode).mockResolvedValue(true)
    })

    it('plays via the backend and sends no audio:chunk IPC when the track can decode', async () => {
      const { startAudioStream } = await import('@/api/audio-stream')
      const { playMusic } = await import('@/api/player')
      const { wrapper, player } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()

      expect(playMusic).toHaveBeenCalledWith('g1', 'm1', {
        volume: expect.closeTo(64),
        loop: false,
        fadeInMs: 0,
      })
      expect(startAudioStream).not.toHaveBeenCalled()
    })

    it('crossfades via the backend (fadeInMs on the new track) without the renderer separately stopping the old one', async () => {
      const { playMusic, stopMusic } = await import('@/api/player')
      const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()
      vi.mocked(playMusic).mockClear()

      await testRouter.push('/scenes/y1')
      await flushPromises()

      expect(playMusic).toHaveBeenCalledWith('g1', 'm2', {
        volume: expect.closeTo(64),
        loop: false,
        fadeInMs: 100,
      })
      // The backend fades and stops the previous track itself (see
      // GuildAudioManager.playMusic) — the renderer must not also call
      // stopMusic for it.
      expect(stopMusic).not.toHaveBeenCalled()
    })

    it('does not orphan the outgoing backend track if the incoming one fails to start', async () => {
      const { playMusic, stopMusic } = await import('@/api/player')
      const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()
      vi.mocked(playMusic).mockClear()
      vi.mocked(playMusic).mockRejectedValueOnce(new Error('decode failed'))

      await testRouter.push('/scenes/y1')
      await flushPromises()

      // The incoming call was attempted and failed; the backend was never
      // told to stop the still-playing outgoing track (m1).
      expect(playMusic).toHaveBeenCalledWith('g1', 'm2', expect.anything())
      expect(stopMusic).not.toHaveBeenCalled()

      // It must still be reachable via Stop — not silently orphaned. Scene Y
      // is now the Playing Scene (set eagerly before the switch attempted),
      // so its own playback bar's Stop button is what's visible; clicking it
      // must still reach and silence the still-playing backend track.
      await wrapper.find('.btn-stop-scene').trigger('click')
      await flushPromises()

      expect(stopMusic).toHaveBeenCalledWith('g1', {})
    })

    it('stops the backend track immediately via the inline Stop button', async () => {
      const { stopMusic } = await import('@/api/player')
      const { wrapper, player } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()

      await wrapper.find('[aria-label="Stop music"]').trigger('click')
      await flushPromises()

      expect(stopMusic).toHaveBeenCalledWith('g1', {})
    })

    it('does not orphan the outgoing backend track when crossfading to a track that falls back to the renderer', async () => {
      const { canDecode } = await import('@/api/sounds')
      // m1 (outgoing) is backend-decodable; m2 (incoming) is not (e.g. m4a) —
      // a mixed-path crossfade the backend is never told about.
      vi.mocked(canDecode).mockImplementation(async (_type, id) => id === 'm1')
      const { startAudioStream } = await import('@/api/audio-stream')
      const { playMusic, stopMusic } = await import('@/api/player')
      const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()
      expect(playMusic).toHaveBeenCalledWith('g1', 'm1', expect.anything())

      await testRouter.push('/scenes/y1')
      await flushPromises()

      // The incoming track falls back to the renderer path (chunked IPC)...
      expect(startAudioStream).toHaveBeenCalled()
      // ...and the previous backend track must still be explicitly stopped,
      // not silently left running with no reachable UI handle.
      expect(stopMusic).toHaveBeenCalledWith('g1', { fadeOutMs: 100 })
    })
  })

  describe('backend-decoded Ambience (ADR-0003)', () => {
    beforeEach(async () => {
      const { canDecode } = await import('@/api/sounds')
      vi.mocked(canDecode).mockResolvedValue(true)
    })

    it('plays via the backend and sends no audio:effectChunk IPC when the sound can decode', async () => {
      const { startEffectStream, sendEffectChunk } = await import('@/api/audio-stream')
      const { playAmbience } = await import('@/api/player')
      const { wrapper, player } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()

      expect(playAmbience).toHaveBeenCalledWith('g1', 'amb-1', {
        volume: expect.closeTo(64),
        repeatMin: 0,
        repeatMax: 0,
        fadeInMs: 0,
      })
      expect(startEffectStream).not.toHaveBeenCalled()
      expect(sendEffectChunk).not.toHaveBeenCalled()
    })

    it('glides a shared Ambience sound to its new volume via the backend without restarting it, and fades in a sound new to the target Scene', async () => {
      const { playAmbience, setAmbienceVolume } = await import('@/api/player')
      const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()
      vi.mocked(playAmbience).mockClear()

      await testRouter.push('/scenes/y1')
      await flushPromises()

      // amb-1 is shared (present in both x1 and y1, at a different volume in
      // each) — glided to y1's volume via the backend, never restarted.
      expect(setAmbienceVolume).toHaveBeenCalledWith('g1', 'amb-1', expect.closeTo(32), { rampMs: 100 })
      expect(playAmbience).not.toHaveBeenCalledWith('g1', 'amb-1', expect.anything())
      // amb-2 is new to the target Scene — starts fresh via the backend with a fade-in.
      expect(playAmbience).toHaveBeenCalledWith('g1', 'amb-2', {
        volume: expect.closeTo(48),
        repeatMin: 0,
        repeatMax: 0,
        fadeInMs: 100,
      })
    })

    it('stops an outgoing-only Ambience sound via the backend when the target Scene drops it', async () => {
      const { stopAmbience } = await import('@/api/player')
      const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()

      await testRouter.push('/scenes/z1')
      await flushPromises()

      expect(stopAmbience).toHaveBeenCalledWith('g1', 'amb-1', { fadeOutMs: 100 })
    })

    it('toggling an Ambience sound off stops it via the backend, not the chunked-IPC effect stream', async () => {
      const { stopEffectStream } = await import('@/api/audio-stream')
      const { stopAmbience } = await import('@/api/player')
      const { wrapper, player } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()

      await wrapper.find('input[type="checkbox"]').setValue(false)
      await flushPromises()

      expect(stopAmbience).toHaveBeenCalledWith('g1', 'amb-1', {})
      expect(stopEffectStream).not.toHaveBeenCalledWith('g1', 'ambience-amb-1')
    })

    it('does not orphan an outgoing backend Ambience sound when crossfading to a Scene whose shared sound falls back to the renderer', async () => {
      const { canDecode } = await import('@/api/sounds')
      // amb-1 (outgoing, shared) is backend-decodable; amb-2 (new to the
      // target) is not (e.g. m4a) — a mixed-decodability crossfade.
      vi.mocked(canDecode).mockImplementation(async (_type, id) => id === 'amb-1')
      const { startEffectStream } = await import('@/api/audio-stream')
      const { playAmbience, setAmbienceVolume } = await import('@/api/player')
      const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
      player.playerState = [
        {
          guildId: 'g1',
          connectedChannelId: 'c1',
          isIdle: true,
          track: null,
          source: 'live' as const,
        },
      ]
      player.guildId = 'g1'
      await flushPromises()

      await wrapper.find('.btn-play-scene').trigger('click')
      await flushPromises()
      expect(playAmbience).toHaveBeenCalledWith('g1', 'amb-1', expect.anything())

      await testRouter.push('/scenes/y1')
      await flushPromises()

      // amb-1 stays backend-sourced and is simply glided to y1's volume...
      expect(setAmbienceVolume).toHaveBeenCalledWith('g1', 'amb-1', expect.closeTo(32), { rampMs: 100 })
      // ...while amb-2 (new, not backend-decodable) falls back to the
      // renderer path instead of being orphaned or silently dropped.
      expect(startEffectStream).toHaveBeenCalledWith('g1', 'ambience-amb-2')
    })
  })
})

describe('sceneView — Output Target routing (#517)', () => {
  beforeAll(stubMediaElement)

  beforeEach(async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockImplementation(async () => JSON.parse(JSON.stringify(scene)))
    const { canDecode } = await import('@/api/sounds')
    vi.mocked(canDecode).mockResolvedValue(true)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    const { canDecode } = await import('@/api/sounds')
    vi.mocked(canDecode).mockResolvedValue(false)
  })

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  async function mountTarget(target: 'local' | 'discord') {
    await router.push('/scenes/s1')
    await router.isReady()
    const pinia = createPinia()
    const wrapper = mount(SceneView, {
      global: {
        plugins: [pinia, router],
        stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
      },
    })
    await flushPromises()
    const player = usePlayerStore(pinia)
    player.activeTarget = target
    await flushPromises()
    return { wrapper, player }
  }

  const joined = [
    {
      guildId: 'g1',
      connectedChannelId: 'c1',
      isIdle: true,
      track: null,
      source: 'live' as const,
    },
  ]

  it('plays a Scene on the Local Target with no voice connection and a single Play button', async () => {
    const { playAmbience } = await import('@/api/player')
    const { wrapper, player } = await mountTarget('local')
    expect(wrapper.findAll('.btn-play-scene')).toHaveLength(1)
    expect(wrapper.find('.btn-play-local').exists()).toBe(false)

    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()

    expect(playAmbience).toHaveBeenCalledWith(LOCAL_TARGET_ID, 'amb-1', expect.anything())
    expect(player.playingSceneMode).toBe(LOCAL_TARGET_ID)
  })

  it('disables Play on the Discord Target until a channel is joined', async () => {
    const { wrapper, player } = await mountTarget('discord')
    expect(wrapper.find('.btn-play-scene').attributes('disabled')).toBeDefined()
    player.playerState = joined
    player.guildId = 'g1'
    await flushPromises()
    expect(wrapper.find('.btn-play-scene').attributes('disabled')).toBeUndefined()
  })

  it('plays a renderer-fallback sound locally without capturing it into the mix', async () => {
    const { canDecode } = await import('@/api/sounds')
    vi.mocked(canDecode).mockResolvedValue(false)
    const { startEffectStream, stopEffectStream } = await import('@/api/audio-stream')
    const { captureFromAudioElement } = await import('@/audio/browser-audio-capture')
    const { playAmbience } = await import('@/api/player')
    const { wrapper } = await mountTarget('local')

    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(playAmbience).not.toHaveBeenCalled()
    expect(startEffectStream).not.toHaveBeenCalled()
    expect(captureFromAudioElement).not.toHaveBeenCalled()

    await wrapper.find('.btn-stop-scene').trigger('click')
    await flushPromises()
    expect(stopEffectStream).not.toHaveBeenCalled()
  })

  it('triggers an Effect on the Local Target through the backend mix', async () => {
    const { playEffect } = await import('@/api/player')
    const { wrapper } = await mountTarget('local')
    await wrapper.find('.effect-trigger').trigger('click')
    await flushPromises()
    expect(playEffect).toHaveBeenCalledWith(LOCAL_TARGET_ID, 'fx-1', expect.anything())
  })

  it('hands a playing Scene over hard: stops on the old Target, restarts from the top on the new one', async () => {
    const { playAmbience, stopAmbience, stopEffects } = await import('@/api/player')
    const { updateActiveOutputTarget } = await import('@/api/config')
    const { wrapper, player } = await mountTarget('local')
    player.playerState = joined
    player.guildId = 'g1'
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneMode).toBe(LOCAL_TARGET_ID)

    vi.mocked(playAmbience).mockClear()
    const discordOption = wrapper.findAll('.target-option').find(b => b.text() === 'Discord')
    await discordOption!.trigger('click')
    await flushPromises()

    expect(stopAmbience).toHaveBeenCalledWith(LOCAL_TARGET_ID, 'amb-1', {})
    expect(stopEffects).toHaveBeenCalledWith(LOCAL_TARGET_ID)
    expect(updateActiveOutputTarget).toHaveBeenCalledWith('discord')
    expect(playAmbience).toHaveBeenCalledWith('g1', 'amb-1', expect.anything())
    expect(player.playingSceneId).toBe('s1')
    expect(player.playingSceneMode).toBe('g1')
  })

  it('restarts the handed-over Scene on Discord once a channel is joined', async () => {
    const { playAmbience, stopAmbience } = await import('@/api/player')
    const { wrapper, player } = await mountTarget('local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()

    vi.mocked(playAmbience).mockClear()
    await wrapper.findAll('.target-option').find(b => b.text() === 'Discord')!.trigger('click')
    await flushPromises()
    expect(stopAmbience).toHaveBeenCalledWith(LOCAL_TARGET_ID, 'amb-1', {})
    expect(playAmbience).not.toHaveBeenCalled()
    expect(player.playingSceneId).toBeNull()

    player.playerState = joined
    player.guildId = 'g1'
    await flushPromises()

    expect(playAmbience).toHaveBeenCalledWith('g1', 'amb-1', expect.anything())
    expect(player.playingSceneId).toBe('s1')
  })

  it('shows and writes the active Target\'s master volume', async () => {
    const { fetchMasterVolume, updateMasterVolume } = await import('@/api/config')
    vi.mocked(fetchMasterVolume).mockImplementation(async (id: string) => (id === LOCAL_TARGET_ID
      ? 35
      : 80))
    const { wrapper } = await mountTarget('discord')
    await wrapper.findAll('.target-option').find(b => b.text() === 'Local')!.trigger('click')
    await flushPromises()
    expect(fetchMasterVolume).toHaveBeenCalledWith(LOCAL_TARGET_ID)
    const slider = wrapper.find('.volume-slider')
    expect((slider.element as HTMLInputElement).value).toBe('35')

    await slider.setValue(50)
    await slider.trigger('change')
    expect(updateMasterVolume).toHaveBeenCalledWith(LOCAL_TARGET_ID, 50)
    vi.mocked(fetchMasterVolume).mockResolvedValue(80)
  })

  it('keeps a Local Playing Scene running when the voice connection drops', async () => {
    const { wrapper, player } = await mountTarget('local')
    player.playerState = joined
    player.guildId = 'g1'
    await flushPromises()
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()

    player.playerState = []
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')
  })

  it('shows which Target a Playing Scene is on in the Scene list', async () => {
    const { listScenes } = await import('@/api/scenes')
    vi.mocked(listScenes).mockResolvedValue([
      JSON.parse(JSON.stringify(scene)),
    ])
    const { wrapper, player } = await mountTarget('local')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    await router.push('/scenes')
    await flushPromises()
    expect(wrapper.find('.playing-badge').attributes('aria-label')).toBe('Playing locally')

    player.setPlayingScene('s1', 'g1')
    await flushPromises()
    expect(wrapper.find('.playing-badge').attributes('aria-label')).toBe('Playing on Discord')
  })
})

describe('sceneView hotkeys', () => {
  beforeAll(stubMediaElement)

  beforeEach(async () => {
    const { getScene, saveScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue(JSON.parse(JSON.stringify(scene)))
    vi.mocked(saveScene).mockReset()
    vi.mocked(saveScene).mockResolvedValue(undefined as never)
  })

  async function record(wrapper: Awaited<ReturnType<typeof mountScene>>, index: number, code: string) {
    const button = wrapper.findAll('[data-testid="hotkey-recorder-button"]')[index]
    await button.trigger('click')
    await button.trigger('keydown', { code })
    await flushPromises()
  }

  it('binds a Scene Hotkey from the editor header and saves the Scene', async () => {
    const { saveScene } = await import('@/api/scenes')
    const wrapper = await mountScene()
    await record(wrapper, 0, 'F13')
    expect(vi.mocked(saveScene).mock.calls.at(-1)![0]).toMatchObject({ id: 's1', hotkey: 'F13' })
  })

  it('binds an Effect Hotkey on the Effect card and shows it as a chip', async () => {
    const { saveScene } = await import('@/api/scenes')
    const wrapper = await mountScene()
    await record(wrapper, 1, 'F14')
    const saved = vi.mocked(saveScene).mock.calls.at(-1)![0] as { effects: { hotkey?: string }[] }
    expect(saved.effects[0].hotkey).toBe('F14')
    expect(wrapper.find('[data-testid="effect-hotkey-recorder"] .hotkey-chip').text()).toBe('F14')
  })

  it('reverts and shows the rejection inline when the model refuses the key', async () => {
    const { saveScene } = await import('@/api/scenes')
    vi.mocked(saveScene).mockRejectedValue(new Error('F13 is already used by Scene \'Tavern\''))
    const wrapper = await mountScene()
    await record(wrapper, 0, 'F13')
    expect(wrapper.find('[data-testid="hotkey-recorder-error"]').text()).toContain('Tavern')
    expect(wrapper.find('[data-testid="hotkey-recorder-clear"]').exists()).toBe(false)
  })

  it('shows the bound key as a chip on the Scene list', async () => {
    const { listScenes } = await import('@/api/scenes')
    vi.mocked(listScenes).mockResolvedValue([
      {
        ...JSON.parse(JSON.stringify(scene)),
        hotkey: 'F15',
      },
    ])
    const wrapper = await mountScene()
    await router.push('/scenes')
    await flushPromises()
    expect(wrapper.find('[data-testid="scene-hotkey-chip"]').text()).toBe('F15')
  })
})

describe('sceneView — Music Mode control', () => {
  beforeAll(stubMediaElement)

  beforeEach(async () => {
    const { getScene, saveScene } = await import('@/api/scenes')
    vi.mocked(saveScene).mockClear()
    vi.mocked(getScene).mockResolvedValue({
      ...JSON.parse(JSON.stringify(scene)),
      music: [
        {
          soundId: 'm1',
          soundName: 'Tavern Theme',
          volume: 80,
          loop: true,
        },
      ],
    })
  })

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  const modeButton = (wrapper: Awaited<ReturnType<typeof mountScene>>, label: string) =>
    wrapper.findAll('.music-mode-option').find(b => b.text() === label)!

  it('starts on Single with the Loop toggle shown for a Scene without a Music Mode', async () => {
    const wrapper = await mountScene()
    expect(modeButton(wrapper, 'Single').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.scene-section-music .toggle input').exists()).toBe(true)
  })

  it('saves the chosen mode, hides the Loop toggle outside Single and restores it with its old value', async () => {
    const { saveScene } = await import('@/api/scenes')
    const wrapper = await mountScene()

    await modeButton(wrapper, 'Shuffle').trigger('click')
    expect(saveScene).toHaveBeenLastCalledWith(expect.objectContaining({ musicMode: 'shuffle' }))
    expect(modeButton(wrapper, 'Shuffle').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.scene-section-music .toggle input').exists()).toBe(false)

    await modeButton(wrapper, 'Single').trigger('click')
    const loop = wrapper.find('.scene-section-music .toggle input')
    expect(loop.exists()).toBe(true)
    expect((loop.element as HTMLInputElement).checked).toBe(true)
  })
})

describe('sceneView — accessible editor controls', () => {
  beforeEach(async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue({
      ...JSON.parse(JSON.stringify(scene)),
      music: [
        {
          soundId: 'm1',
          soundName: 'Tavern Theme',
          volume: 80,
          loop: true,
        },
      ],
    })
  })

  it('names each per-sound editor control after its sound', async () => {
    const wrapper = await mountScene()
    const labels = wrapper.findAll('[aria-label]').map(el => el.attributes('aria-label'))
    expect(labels).toEqual(expect.arrayContaining([
      'Add ambience',
      'Add music',
      'Add effect',
      'Volume for Rain',
      'Enable Rain',
      'Shortest repeat interval for Rain',
      'Longest repeat interval for Rain',
      'Volume for Tavern Theme',
      'Loop Tavern Theme',
    ]))
  })
})

describe('sceneView — failure handling and stale playback (#655)', () => {
  beforeAll(stubMediaElement)

  const withMusic = {
    ...JSON.parse(JSON.stringify(scene)),
    music: [
      {
        soundId: 'm1',
        soundName: 'Tavern Theme',
        volume: 80,
        loop: true,
      },
    ],
  }

  beforeEach(async () => {
    const { getScene, listScenes, saveScene, deleteScene } = await import('@/api/scenes')
    const { canDecode, listMusic } = await import('@/api/sounds')
    vi.mocked(getScene).mockResolvedValue(JSON.parse(JSON.stringify(withMusic)))
    vi.mocked(listScenes).mockResolvedValue([])
    vi.mocked(saveScene).mockReset()
    vi.mocked(saveScene).mockResolvedValue(undefined as never)
    vi.mocked(deleteScene).mockReset()
    vi.mocked(deleteScene).mockResolvedValue(undefined)
    vi.mocked(canDecode).mockResolvedValue(true)
    vi.mocked(listMusic).mockResolvedValue([
      { id: 'm1', name: 'Tavern Theme', filename: 'tavern.mp3' } as never,
    ])
  })

  afterEach(async () => {
    const { canDecode, listMusic } = await import('@/api/sounds')
    vi.mocked(canDecode).mockResolvedValue(false)
    vi.mocked(listMusic).mockResolvedValue([])
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterAll(() => {
    Object.defineProperty(mediaProto, 'load', { configurable: true, value: originalMedia.load })
    Object.defineProperty(mediaProto, 'play', { configurable: true, value: originalMedia.play })
    Object.defineProperty(mediaProto, 'pause', { configurable: true, value: originalMedia.pause })
  })

  async function mountAtPath(path: string) {
    await router.push(path)
    await router.isReady()
    const pinia = createPinia()
    const wrapper = mount(SceneView, {
      global: {
        plugins: [pinia, router],
        stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
      },
    })
    await flushPromises()
    const player = usePlayerStore(pinia)
    player.activeTarget = 'local'
    await flushPromises()
    return {
      wrapper,
      player,
      toasts: useToastStore(pinia),
    }
  }

  it('creates one Scene when Enter is pressed twice before the first save resolves', async () => {
    const { saveScene } = await import('@/api/scenes')
    let resolveSave!: (s: unknown) => void
    vi.mocked(saveScene).mockImplementation(() => new Promise((resolve) => {
      resolveSave = resolve as (s: unknown) => void
    }))
    const { wrapper } = await mountAtPath('/scenes')
    await wrapper.findAll('button').find(b => b.text() === 'New scene')!.trigger('click')
    const input = wrapper.find('.create-scene-input')
    await input.setValue('Dungeon')
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(saveScene).toHaveBeenCalledTimes(1)
    resolveSave({ ...withMusic, id: 'new-1', name: 'Dungeon' })
    await flushPromises()
    wrapper.unmount()
  })

  it('stops the playing Music track when it is removed from the Scene', async () => {
    const { stopMusic } = await import('@/api/player')
    vi.mocked(stopMusic).mockClear()
    const { wrapper } = await mountAtPath('/scenes/s1')
    await wrapper.find('[aria-label="Play Tavern Theme"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="Stop music"]').exists()).toBe(true)

    await wrapper.find('[aria-label="Remove Tavern Theme"]').trigger('click')
    await flushPromises()

    expect(stopMusic).toHaveBeenCalledWith('local', {})
    wrapper.unmount()
  })

  it('stops a removed Effect\'s instances', async () => {
    const { wrapper, player } = await mountAtPath('/scenes/s1')
    const stopEffectSound = vi.spyOn(player, 'stopEffectSound')
    await wrapper.find('[aria-label="Remove Thunder"]').trigger('click')
    await flushPromises()
    expect(stopEffectSound).toHaveBeenCalledWith('fx-1')
    wrapper.unmount()
  })

  it('shows the load error instead of the empty state when the Scene list fails to load', async () => {
    const { listScenes } = await import('@/api/scenes')
    vi.mocked(listScenes).mockRejectedValue(new Error('scenes.json is corrupt'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper } = await mountAtPath('/scenes')

    expect(wrapper.find('[data-testid="scene-load-error"]').text()).toContain('scenes.json is corrupt')
    expect(wrapper.find('.scene-empty').exists()).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[scenes]'), expect.any(Error))
    wrapper.unmount()
  })

  it('shows the load error instead of "Loading…" forever when the Scene fails to load', async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockRejectedValue(new Error('scene not readable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper } = await mountAtPath('/scenes/s1')

    expect(wrapper.find('[data-testid="scene-load-error"]').text()).toContain('scene not readable')
    expect(wrapper.find('.detail-title').text()).not.toBe('Loading…')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[scenes]'), expect.any(Error))
    wrapper.unmount()
  })

  it('rolls a failed item save back, logs it and shows an error toast', async () => {
    const { saveScene } = await import('@/api/scenes')
    vi.mocked(saveScene).mockRejectedValue(new Error('disk full'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper, toasts } = await mountAtPath('/scenes/s1')

    const slider = wrapper.find('[aria-label="Volume for Rain"]')
    await slider.setValue('30')
    await slider.trigger('change')
    await flushPromises()

    expect((wrapper.find('[aria-label="Volume for Rain"]').element as HTMLInputElement).value).toBe('80')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[scenes] save failed'), expect.any(Error))
    expect(toasts.toasts.some(t => t.type === 'error')).toBe(true)
    wrapper.unmount()
  })

  it('turns a toggled-off Ambience sound back on when the toggle fails to save', async () => {
    const { saveScene } = await import('@/api/scenes')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = await mountAtPath('/scenes/s1')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sound-card-ambience').classes()).toContain('pulse-breathe')

    vi.mocked(saveScene).mockRejectedValue(new Error('disk full'))
    await wrapper.find('[aria-label="Enable Rain"]').setValue(false)
    await flushPromises()

    expect((wrapper.find('[aria-label="Enable Rain"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('.sound-card-ambience').classes()).toContain('pulse-breathe')
    wrapper.unmount()
  })

  it('brings a removed item back when the removal fails to save', async () => {
    const { saveScene } = await import('@/api/scenes')
    vi.mocked(saveScene).mockRejectedValue(new Error('disk full'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = await mountAtPath('/scenes/s1')

    await wrapper.find('[aria-label="Remove Door slam"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[aria-label="Remove Door slam"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('restarts a removed enabled Ambience sound when the removal fails to save', async () => {
    const { saveScene } = await import('@/api/scenes')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = await mountAtPath('/scenes/s1')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()

    vi.mocked(saveScene).mockRejectedValue(new Error('disk full'))
    await wrapper.find('[aria-label="Remove Rain"]').trigger('click')
    await flushPromises()

    expect((wrapper.find('[aria-label="Enable Rain"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('.sound-card-ambience').classes()).toContain('pulse-breathe')
    wrapper.unmount()
  })

  it('keeps the Scene playing and open when deleting it fails', async () => {
    vi.stubGlobal('confirm', () => true)
    const { deleteScene } = await import('@/api/scenes')
    vi.mocked(deleteScene).mockRejectedValue(new Error('locked'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper, player, toasts } = await mountAtPath('/scenes/s1')
    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()

    await wrapper.find('.btn-danger').trigger('click')
    await flushPromises()

    expect(player.playingSceneId).toBe('s1')
    expect(router.currentRoute.value.path).toBe('/scenes/s1')
    expect(toasts.toasts.some(t => t.type === 'error')).toBe(true)
    wrapper.unmount()
  })
})

describe('sceneView — Scene order (#697)', () => {
  const named = (id: string, name: string) => ({
    ...JSON.parse(JSON.stringify(scene)),
    id,
    name,
  })

  beforeEach(async () => {
    const { listScenes, moveScene } = await import('@/api/scenes')
    vi.mocked(listScenes).mockResolvedValue([
      named('a', 'Alpha'),
      named('b', 'Bravo'),
      named('c', 'Charlie'),
    ])
    vi.mocked(moveScene).mockReset()
    vi.mocked(moveScene).mockResolvedValue(undefined)
  })

  async function mountList() {
    await router.push('/scenes')
    await router.isReady()
    const pinia = createPinia()
    const wrapper = mount(SceneView, {
      attachTo: document.body,
      global: {
        plugins: [pinia, router],
        stubs: { RegistryBrowser: true, ResolveSoundDialog: true },
      },
    })
    await flushPromises()
    return { wrapper, pinia }
  }

  const names = (wrapper: Awaited<ReturnType<typeof mountList>>['wrapper']) =>
    wrapper.findAll('.scene-list-name').map(n => n.text())
  const grip = (wrapper: Awaited<ReturnType<typeof mountList>>['wrapper'], name: string) =>
    wrapper.find(`[aria-label="Reorder ${name}"]`)

  it('moves a Scene down and up with the arrow keys on its grip, saving each move and keeping focus', async () => {
    const { moveScene } = await import('@/api/scenes')
    const { wrapper } = await mountList()

    await grip(wrapper, 'Alpha').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(names(wrapper)).toEqual(['Bravo', 'Alpha', 'Charlie'])
    expect(moveScene).toHaveBeenLastCalledWith('a', 1)
    expect(document.activeElement).toBe(grip(wrapper, 'Alpha').element)
    expect(wrapper.find('[data-testid="scene-order-status"]').text()).toBe('Alpha moved to position 2 of 3')

    await grip(wrapper, 'Charlie').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()
    expect(names(wrapper)).toEqual(['Bravo', 'Charlie', 'Alpha'])
    expect(moveScene).toHaveBeenLastCalledWith('c', 1)
    wrapper.unmount()
  })

  it('does nothing past either end of the list', async () => {
    const { moveScene } = await import('@/api/scenes')
    const { wrapper } = await mountList()
    await grip(wrapper, 'Alpha').trigger('keydown', { key: 'ArrowUp' })
    await grip(wrapper, 'Charlie').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(names(wrapper)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(moveScene).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('moves a Scene dropped onto another row to that row\'s position', async () => {
    const { moveScene } = await import('@/api/scenes')
    const { wrapper } = await mountList()
    const rows = wrapper.findAll('.scene-list-row')

    await grip(wrapper, 'Charlie').trigger('dragstart')
    await rows[0].trigger('dragover')
    expect(rows[0].classes()).toContain('scene-list-row-drop-before')
    expect(rows[2].classes()).toContain('scene-list-row-dragging')
    await rows[0].trigger('dragleave')
    expect(rows[0].classes()).not.toContain('scene-list-row-drop-before')
    await rows[0].trigger('dragover')
    await rows[0].trigger('drop')
    await flushPromises()
    expect(names(wrapper)).toEqual(['Charlie', 'Alpha', 'Bravo'])
    expect(moveScene).toHaveBeenCalledWith('c', 0)
    wrapper.unmount()
  })

  it('ignores a drop with no Scene being dragged and a drop onto the dragged row itself', async () => {
    const { moveScene } = await import('@/api/scenes')
    const { wrapper } = await mountList()
    const rows = wrapper.findAll('.scene-list-row')

    await rows[1].trigger('drop')
    await grip(wrapper, 'Alpha').trigger('dragstart')
    await rows[0].trigger('drop')
    await flushPromises()
    expect(names(wrapper)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(moveScene).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('saves quick successive moves one at a time, in order', async () => {
    const { moveScene } = await import('@/api/scenes')
    const settle: (() => void)[] = []
    vi.mocked(moveScene).mockImplementation(() => new Promise<void>(resolve => settle.push(resolve)))
    const { wrapper } = await mountList()

    await grip(wrapper, 'Alpha').trigger('keydown', { key: 'ArrowDown' })
    await grip(wrapper, 'Alpha').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(names(wrapper)).toEqual(['Bravo', 'Charlie', 'Alpha'])
    expect(moveScene).toHaveBeenCalledTimes(1)
    settle[0]()
    await flushPromises()
    expect(moveScene).toHaveBeenCalledTimes(2)
    expect(moveScene).toHaveBeenLastCalledWith('a', 2)
    settle[1]()
    await flushPromises()
    wrapper.unmount()
  })

  it('reloads the saved order, logs and shows an error toast when a move fails', async () => {
    const { listScenes, moveScene } = await import('@/api/scenes')
    vi.mocked(moveScene).mockRejectedValue(new Error('disk full'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper, pinia } = await mountList()
    const listCalls = vi.mocked(listScenes).mock.calls.length

    await grip(wrapper, 'Alpha').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(vi.mocked(listScenes).mock.calls.length).toBe(listCalls + 1)
    expect(names(wrapper)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[scenes]'), expect.any(Error))
    expect(useToastStore(pinia).toasts.some(t => t.type === 'error')).toBe(true)
    warn.mockRestore()
    wrapper.unmount()
  })

  it('drops moves queued behind a failed one so the list and the saved order agree', async () => {
    const { moveScene } = await import('@/api/scenes')
    const settle: ((err?: Error) => void)[] = []
    vi.mocked(moveScene).mockImplementation(() => new Promise<void>((resolve, reject) =>
      settle.push(err => err
        ? reject(err)
        : resolve())))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper } = await mountList()

    await grip(wrapper, 'Alpha').trigger('keydown', { key: 'ArrowDown' })
    await grip(wrapper, 'Alpha').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    settle[0](new Error('disk full'))
    await flushPromises()
    expect(moveScene).toHaveBeenCalledTimes(1)
    expect(names(wrapper)).toEqual(['Alpha', 'Bravo', 'Charlie'])

    await grip(wrapper, 'Charlie').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()
    expect(moveScene).toHaveBeenCalledTimes(2)
    expect(moveScene).toHaveBeenLastCalledWith('c', 1)
    settle[1]()
    await flushPromises()
    warn.mockRestore()
    wrapper.unmount()
  })
})
