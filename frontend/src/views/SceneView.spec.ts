import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { fetchSceneFadeLength, fetchVisionConfig } from '@/api/config'
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
  // 0.1s rather than the real 3s default, so crossfade tests can wait for a
  // fade to actually complete with a short, real setTimeout-based `wait()`.
  fetchSceneFadeLength: vi.fn().mockResolvedValue(0.1),
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

  async function mountSceneWithPlayer() {
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
    return { wrapper, player: usePlayerStore(pinia) }
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
      { guildId: 'g1', connectedChannelId: 'c1', isIdle: true, track: null, source: 'live' as const },
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
    const { wrapper, player } = await mountSceneWithPlayer()
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')
    expect(player.playingSceneMode).toBe('local')

    await router.push('/scenes')
    await flushPromises()

    expect(player.playingSceneId).toBe('s1')
    expect(player.playingSceneMode).toBe('local')
  })

  it('marks the playing Scene in the list and stops it from there', async () => {
    const { wrapper, player } = await mountSceneWithPlayer()
    await wrapper.find('.btn-play-local').trigger('click')
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
    const { wrapper, player } = await mountSceneWithPlayer()
    await wrapper.find('.btn-play-local').trigger('click')
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
    vi.mocked(listMusic).mockImplementation(async () => [{ id: 'm1', name: 'Tavern Theme', filename: 'tavern.mp3' }])
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockImplementation(async () => ({
      id: 's1',
      name: 'Storm',
      ambience: [],
      music: [{ soundId: 'm1', soundName: 'Tavern Theme', volume: 80, loop: false }],
      effects: [],
    }))

    const { wrapper, player } = await mountSceneWithPlayer()
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()
    expect(player.playingSceneMode).toBe('local')

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
    const { wrapper, player } = await mountSceneWithPlayer()
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')

    await router.push('/scenes/s2')
    await flushPromises()

    // The new Scene becomes the Playing Scene immediately, in the same
    // mode — this is a crossfade, not a stop-then-silence.
    expect(wrapper.find('.detail-title').text()).toBe('Tavern')
    expect(player.playingSceneId).toBe('s2')
    expect(player.playingSceneMode).toBe('local')
    expect(wrapper.find('.btn-stop-scene').exists()).toBe(true)

    await wait(300)
    await flushPromises()

    // Once the fade completes, nothing from the old Scene is left running —
    // Tavern (s2) itself has no sounds, so the summary just says so.
    expect(wrapper.find('.now-playing-line').text()).toBe('Scene playing')
  })

  it('crossfades to a different Scene when opening it from the Scene list', async () => {
    const { wrapper, player } = await mountSceneWithPlayer()
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')

    await router.push('/scenes')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')

    await router.push('/scenes/s2')
    await flushPromises()

    expect(player.playingSceneId).toBe('s2')
    expect(player.playingSceneMode).toBe('local')
  })

  it('stops the playing Scene when it is deleted', async () => {
    vi.stubGlobal('confirm', () => true)
    const { deleteScene } = await import('@/api/scenes')
    const { wrapper, player } = await mountSceneWithPlayer()
    await wrapper.find('.btn-play-local').trigger('click')
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
      { guildId: 'g1', connectedChannelId: 'c1', isIdle: true, track: null, source: 'live' as const },
    ]
    player.guildId = 'g1'
    await flushPromises()

    await wrapper.find('.btn-play-scene').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')
    expect(player.playingSceneMode).toBe('discord')

    await router.push('/scenes')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')

    const row = wrapper.findAll('.scene-list-row').find(r => r.text().includes('Storm'))
    await row!.find('.btn-stop-list').trigger('click')
    await flushPromises()

    expect(player.playingSceneId).toBeNull()
  })

  it('stops a Discord item toggled individually on voice loss without disturbing a concurrent local Playing Scene', async () => {
    // mockImplementation (not mockResolvedValueOnce) because a prior test's
    // wrapper is never unmounted and stays subscribed to the shared router —
    // pushing a new route here can trigger its watcher too, consuming a
    // once-queued mock value meant for this test's own mount.
    const { listAmbience } = await import('@/api/sounds')
    vi.mocked(listAmbience).mockImplementation(async () => [
      { id: 'amb-1', name: 'Rain', filename: 'rain.mp3' },
      { id: 'amb-2', name: 'Wind', filename: 'wind.mp3' },
    ])
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockImplementation(async () => ({
      id: 's1',
      name: 'Storm',
      ambience: [
        { soundId: 'amb-1', soundName: 'Rain', volume: 80, enabled: true },
        { soundId: 'amb-2', soundName: 'Wind', volume: 80, enabled: false },
      ],
      music: [],
      effects: [],
    }))

    const { stopEffectStream } = await import('@/api/audio-stream')
    const { wrapper, player } = await mountSceneWithPlayer()
    player.playerState = [
      { guildId: 'g1', connectedChannelId: 'c1', isIdle: true, track: null, source: 'live' as const },
    ]
    player.guildId = 'g1'
    await flushPromises()

    // Local preview plays amb-1 (enabled by default).
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()
    expect(player.playingSceneId).toBe('s1')
    expect(player.playingSceneMode).toBe('local')

    // The GM also joins voice and toggles amb-2 on individually — always the
    // Discord path, independent of the local Playing Scene.
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    await checkboxes[1].setValue(true)
    await flushPromises()

    vi.mocked(stopEffectStream).mockClear()
    player.playerState = []
    await flushPromises()

    // The individually-toggled Discord item stops (as today)...
    expect(stopEffectStream).toHaveBeenCalledWith('g1', 'ambience-amb-2')
    // ...but the local Playing Scene survives losing voice.
    expect(player.playingSceneId).toBe('s1')
    expect(player.playingSceneMode).toBe('local')
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

  async function mountAt(path: string) {
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
    return { wrapper, player: usePlayerStore(pinia), router: testRouter }
  }

  const sceneX = {
    id: 'x1',
    name: 'Camp',
    ambience: [{ soundId: 'amb-1', soundName: 'Rain', volume: 80, enabled: true }],
    music: [{ soundId: 'm1', soundName: 'Track One', volume: 80, loop: false }],
    effects: [],
  }
  // amb-1 is shared with sceneX (at a different volume, to prove the glide),
  // amb-2 is new to this Scene, and the Music track differs entirely.
  const sceneY = {
    id: 'y1',
    name: 'Tavern',
    ambience: [
      { soundId: 'amb-1', soundName: 'Rain', volume: 40, enabled: true },
      { soundId: 'amb-2', soundName: 'Wind', volume: 60, enabled: true },
    ],
    music: [{ soundId: 'm2', soundName: 'Track Two', volume: 80, loop: false }],
    effects: [],
  }
  const sceneZ = { id: 'z1', name: 'Silence', ambience: [], music: [], effects: [] }

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
        Object.defineProperty(instance, 'pause', { configurable: true, value: vi.fn() })
        audioInstances.push(instance)
        return instance
      },
    }))

    const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
    await wrapper.find('.btn-play-local').trigger('click')
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
    const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
    await wrapper.find('.btn-play-local').trigger('click')
    await flushPromises()

    await testRouter.push('/scenes/z1')
    await flushPromises()

    expect(player.playingSceneId).toBe('z1')
    // z1 has no sounds of its own, and the cut was immediate — nothing from
    // x1 should still be reported as playing.
    expect(wrapper.find('.now-playing-line').text()).toBe('Scene playing')
  })

  it('ends with only the newest Scene playing after switching twice during a fade', async () => {
    const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
    await wrapper.find('.btn-play-local').trigger('click')
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
    const { wrapper, player, router: testRouter } = await mountAt('/scenes/x1')
    await wrapper.find('.btn-play-local').trigger('click')
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
      { guildId: 'g1', connectedChannelId: 'c1', isIdle: true, track: null, source: 'live' as const },
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
})
