import type { Scene } from '@/api/scenes'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startEffectStream, stopAudioStream, stopEffectStream } from '@/api/audio-stream'
import { fetchMasterVolume, fetchSceneFadeLength, updateMasterVolume } from '@/api/config'
import { playAmbience, playEffect, playMusic, setAmbienceVolume, setMusicVolume, stopAmbience, stopEffects, stopMusic, warmEffects } from '@/api/player'
import { canDecode } from '@/api/sounds'
import { trackUsage } from '@/api/usage-stats'
import { captureFromAudioElement } from '@/audio/browser-audio-capture'
import { usePlayerStore } from '@/stores/player'
import { useScenePlaybackStore } from './scene-playback'

vi.mock('@/api/scenes', () => ({
  getScene: vi.fn(),
}))
vi.mock('@/api/usage-stats', () => ({
  trackUsage: vi.fn(),
}))
vi.mock('@/api/sounds', () => ({
  soundStreamUrl: vi.fn((type: string, id: string) => `hibiki://sound/${type}/${id}`),
  canDecode: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/api/audio-stream', () => ({
  sendAudioChunk: vi.fn(),
  sendEffectChunk: vi.fn(),
  startAudioStream: vi.fn().mockResolvedValue(undefined),
  startEffectStream: vi.fn().mockResolvedValue(undefined),
  stopAudioStream: vi.fn().mockResolvedValue(undefined),
  stopEffectStream: vi.fn().mockResolvedValue(undefined),
}))
// jsdom has no Web Audio: a stand-in session lets a streamed renderer fallback get as far as `el.play()`.
vi.mock('@/audio/browser-audio-capture', async importOriginal => ({
  ...await importOriginal<typeof import('@/audio/browser-audio-capture')>(),
  captureFromAudioElement: vi.fn().mockResolvedValue({
    stop: vi.fn(),
  }),
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
vi.mock('@/api/config', () => ({
  fetchSceneFadeLength: vi.fn().mockResolvedValue(0),
  fetchMasterVolume: vi.fn().mockResolvedValue(50),
  updateMasterVolume: vi.fn().mockResolvedValue(undefined),
  fetchActiveOutputTarget: vi.fn().mockResolvedValue('local'),
  updateActiveOutputTarget: vi.fn().mockResolvedValue(undefined),
  LOCAL_TARGET_ID: 'local',
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
  music: [
    {
      soundId: 'mus-1',
      soundName: 'Theme',
      volume: 100,
      loop: true,
    },
  ],
  effects: [
    { soundId: 'fx-1', soundName: 'Thunder', volume: 100 },
  ],
}

describe('scene playback store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    const player = usePlayerStore()
    player.activeTarget = 'local'
  })

  it('plays a Scene on the active Target with the master volume applied, without any view', async () => {
    const store = useScenePlaybackStore()
    store.masterVolume = 50
    store.musicSounds = [
      { id: 'mus-1', name: 'Theme', filename: 'theme.mp3' } as never,
    ]

    await store.playScene(scene)

    expect(usePlayerStore().playingSceneId).toBe('s1')
    expect(usePlayerStore().playingSceneMode).toBe('local')
    expect(playAmbience).toHaveBeenCalledWith('local', 'amb-1', expect.objectContaining({ volume: 40 }))
    expect(playMusic).toHaveBeenCalledWith('local', 'mus-1', expect.objectContaining({ volume: 50, loop: true }))
    expect(store.playingMusicId).toBe('mus-1')
    expect(store.playingAmbienceIds.has('amb-1')).toBe(true)
  })

  describe('a play call while the active Target cannot play (#713)', () => {
    beforeEach(() => {
      const player = usePlayerStore()
      player.activeTarget = 'discord'
      player.guildId = 'g1'
      player.playerState = []
    })

    it('logs why an Effect was ignored and does not flash it', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      const store = useScenePlaybackStore()

      await store.playEffect(scene.effects[0]!)

      expect(info).toHaveBeenCalledWith('[scene] playEffect fx-1 ignored: Target g1 cannot play')
      expect(store.effectFlash.has('fx-1')).toBe(false)
      expect(playEffect).not.toHaveBeenCalled()
      info.mockRestore()
    })

    it('logs why Music and Ambience were ignored', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      const store = useScenePlaybackStore()
      store.musicSounds = [
        { id: 'mus-1', name: 'Theme', filename: 'theme.mp3' } as never,
      ]

      await store.playMusic(scene.music[0]!)
      await store.playAmbience(scene.ambience[0]!)

      expect(info).toHaveBeenCalledWith('[scene] playMusic mus-1 ignored: Target g1 cannot play')
      expect(info).toHaveBeenCalledWith('[scene] playAmbience amb-1 ignored: Target g1 cannot play')
      expect(playMusic).not.toHaveBeenCalled()
      expect(playAmbience).not.toHaveBeenCalled()
      info.mockRestore()
    })
  })

  it('stops the Playing Scene: ambience, music, effects and the Playing Scene marker', async () => {
    const store = useScenePlaybackStore()
    store.musicSounds = [
      { id: 'mus-1', name: 'Theme', filename: 'theme.mp3' } as never,
    ]
    await store.playScene(scene)

    store.stopScene()

    expect(stopAmbience).toHaveBeenCalledWith('local', 'amb-1', {})
    expect(stopMusic).toHaveBeenCalledWith('local', {})
    expect(stopEffects).toHaveBeenCalledWith('local')
    expect(usePlayerStore().playingSceneId).toBeNull()
    expect(store.playingAmbienceIds.size).toBe(0)
    expect(store.playingMusicId).toBeNull()
  })

  describe('a Stop or a second Play during Scene start-up', () => {
    const twoAmbienceScene: Scene = {
      ...scene,
      createdAt: '',
      updatedAt: '',
      ambience: [
        ...scene.ambience,
        {
          soundId: 'amb-2',
          soundName: 'Wind',
          volume: 80,
          enabled: true,
        },
      ],
    }
    const otherScene: Scene = {
      ...scene,
      createdAt: '',
      updatedAt: '',
      id: 's2',
      name: 'Tavern',
      ambience: [
        {
          soundId: 'amb-3',
          soundName: 'Crowd',
          volume: 80,
          enabled: true,
        },
      ],
      music: [
        {
          soundId: 'mus-2',
          soundName: 'Jig',
          volume: 100,
          loop: true,
        },
      ],
    }

    function holdFirstAmbience() {
      let release!: () => void
      vi.mocked(playAmbience).mockReturnValueOnce(new Promise<void>((resolve) => {
        release = resolve
      }))
      return () => release()
    }

    function setupStore() {
      const store = useScenePlaybackStore()
      store.musicSounds = [
        { id: 'mus-1', name: 'Theme', filename: 'theme.mp3' },
        { id: 'mus-2', name: 'Jig', filename: 'jig.mp3' },
      ] as never
      return store
    }

    it('a Stop while the first Ambience is starting leaves the rest of the Scene unstarted', async () => {
      const store = setupStore()
      const release = holdFirstAmbience()

      const starting = store.playScene(twoAmbienceScene)
      await vi.waitFor(() => expect(playAmbience).toHaveBeenCalledTimes(1))
      store.stopScene()
      release()
      await starting

      expect(vi.mocked(playAmbience).mock.calls.map(c => c[1])).toEqual(['amb-1'])
      expect(playMusic).not.toHaveBeenCalled()
      expect(store.playingMusicId).toBeNull()
      expect(store.musicSceneId).toBeNull()
      expect(usePlayerStore().playingSceneId).toBeNull()
    })

    it('a second Play while the first Scene is starting ends with only the second Scene\'s Music', async () => {
      const store = setupStore()
      const release = holdFirstAmbience()

      const startingA = store.playScene(twoAmbienceScene)
      await vi.waitFor(() => expect(playAmbience).toHaveBeenCalledTimes(1))
      await store.playScene(otherScene)
      release()
      await startingA

      expect(vi.mocked(playAmbience).mock.calls.map(c => c[1])).toEqual(['amb-1', 'amb-3'])
      expect(vi.mocked(playMusic).mock.calls.map(c => c[1])).toEqual(['mus-2'])
      expect(store.playingMusicId).toBe('mus-2')
      expect(store.musicSceneId).toBe('s2')
      expect(usePlayerStore().playingSceneId).toBe('s2')
    })

    it('a Stop while the first track\'s decode probe is pending leaves Music unstarted', async () => {
      const store = setupStore()
      let releaseProbe!: (decodable: boolean) => void
      vi.mocked(canDecode).mockReturnValueOnce(new Promise((resolve) => {
        releaseProbe = resolve
      }))

      const starting = store.playScene({ ...twoAmbienceScene, ambience: [] })
      await vi.waitFor(() => expect(canDecode).toHaveBeenCalledWith('music', 'mus-1'))
      store.stopScene()
      releaseProbe(true)
      await starting

      expect(playMusic).not.toHaveBeenCalled()
      expect(store.playingMusicId).toBeNull()
      expect(store.musicSceneId).toBeNull()
    })

    it('a Scene Crossfade while the first Scene is starting ends with only the crossfaded Scene\'s Music', async () => {
      const { getScene } = await import('@/api/scenes')
      vi.mocked(getScene).mockResolvedValue(otherScene)
      const store = setupStore()
      const release = holdFirstAmbience()

      const startingA = store.playScene(twoAmbienceScene)
      await vi.waitFor(() => expect(playAmbience).toHaveBeenCalledTimes(1))
      await store.crossfadeToScene('s2')
      release()
      await startingA
      await flushPromises()

      expect(vi.mocked(playAmbience).mock.calls.map(c => c[1])).not.toContain('amb-2')
      expect(vi.mocked(playMusic).mock.calls.map(c => c[1])).toEqual(['mus-2'])
      expect(store.musicSceneId).toBe('s2')
      expect(usePlayerStore().playingSceneId).toBe('s2')
    })
  })

  it('toggles one Ambience sound and triggers one Effect', async () => {
    const store = useScenePlaybackStore()
    const item = { ...scene.ambience[0] }

    store.toggleAmbience(item)
    await vi.waitFor(() => expect(playAmbience).toHaveBeenCalledTimes(1))
    item.enabled = false
    store.toggleAmbience(item)
    expect(stopAmbience).toHaveBeenCalledWith('local', 'amb-1', {})

    await store.playEffect(scene.effects[0])
    expect(playEffect).toHaveBeenCalledWith('local', 'fx-1', expect.objectContaining({ volume: 80 }))
  })

  describe('a Stop while an Ambience sound or Effect is still starting up', () => {
    const mediaProto = HTMLMediaElement.prototype
    const originalMedia = { load: mediaProto.load, play: mediaProto.play, pause: mediaProto.pause }
    let loadingEls: HTMLMediaElement[]
    let playingEls: HTMLMediaElement[]
    let pausedEls: HTMLMediaElement[]

    function holdDecodeProbe() {
      let release!: (decodable: boolean) => void
      vi.mocked(canDecode).mockReturnValueOnce(new Promise((resolve) => {
        release = resolve
      }))
      return (decodable: boolean) => release(decodable)
    }

    function joinDiscordTarget() {
      const player = usePlayerStore()
      player.activeTarget = 'discord'
      player.guildId = 'guild-1'
      player.playerState = [
        { guildId: 'guild-1', connectedChannelId: 'voice-1' } as never,
      ]
    }

    beforeEach(() => {
      loadingEls = []
      playingEls = []
      pausedEls = []
      // Loads never finish on their own: each test fires `canplaythrough` itself.
      Object.defineProperty(mediaProto, 'load', {
        configurable: true,
        value(this: HTMLMediaElement) {
          if (this.getAttribute('src'))
            loadingEls.push(this)
        },
      })
      Object.defineProperty(mediaProto, 'play', {
        configurable: true,
        value(this: HTMLMediaElement) {
          playingEls.push(this)
          return Promise.resolve()
        },
      })
      Object.defineProperty(mediaProto, 'pause', {
        configurable: true,
        value(this: HTMLMediaElement) {
          pausedEls.push(this)
        },
      })
    })

    afterEach(() => {
      for (const [key, value] of Object.entries(originalMedia))
        Object.defineProperty(mediaProto, key, { configurable: true, value })
      vi.mocked(canDecode).mockResolvedValue(true)
      vi.mocked(playAmbience).mockResolvedValue(undefined)
    })

    it('an Ambience toggled off while its decode probe is pending never starts on the backend', async () => {
      const store = useScenePlaybackStore()
      const item = { ...scene.ambience[0] }
      const releaseProbe = holdDecodeProbe()

      store.toggleAmbience(item)
      await vi.waitFor(() => expect(canDecode).toHaveBeenCalledWith('ambience', 'amb-1'))
      store.toggleAmbience({ ...item, enabled: false })
      releaseProbe(true)
      await flushPromises()

      expect(playAmbience).not.toHaveBeenCalled()
      expect(store.playingAmbienceIds.has('amb-1')).toBe(false)
    })

    it('a Scene Stop while an Ambience decode probe is pending never starts that Ambience', async () => {
      const store = useScenePlaybackStore()
      const releaseProbe = holdDecodeProbe()

      const starting = store.playScene({
        ...scene,
        createdAt: '',
        updatedAt: '',
        music: [],
      })
      await vi.waitFor(() => expect(canDecode).toHaveBeenCalledWith('ambience', 'amb-1'))
      store.stopScene()
      releaseProbe(true)
      await starting

      expect(playAmbience).not.toHaveBeenCalled()
      expect(store.playingAmbienceIds.size).toBe(0)
    })

    it('an Ambience toggled off while its backend play is in flight is stopped again once that play lands', async () => {
      const store = useScenePlaybackStore()
      const item = { ...scene.ambience[0] }
      let releasePlay!: () => void
      vi.mocked(playAmbience).mockReturnValueOnce(new Promise<void>((resolve) => {
        releasePlay = resolve
      }))

      store.toggleAmbience(item)
      await vi.waitFor(() => expect(playAmbience).toHaveBeenCalledTimes(1))
      store.toggleAmbience({ ...item, enabled: false })
      releasePlay()
      await flushPromises()

      expect(store.playingAmbienceIds.has('amb-1')).toBe(false)
      expect(stopAmbience).toHaveBeenCalledTimes(2)
      expect(stopAmbience).toHaveBeenLastCalledWith('local', 'amb-1', {})
    })

    it('an Ambience toggled off is stopped again even when a state push re-reported it before its play landed', async () => {
      const store = useScenePlaybackStore()
      const item = { ...scene.ambience[0] }
      let releasePlay!: () => void
      vi.mocked(playAmbience).mockReturnValueOnce(new Promise<void>((resolve) => {
        releasePlay = resolve
      }))

      store.toggleAmbience(item)
      await vi.waitFor(() => expect(playAmbience).toHaveBeenCalledTimes(1))
      store.toggleAmbience({ ...item, enabled: false })
      await flushPromises()
      usePlayerStore().playerState = [
        {
          targetId: 'local',
          kind: 'local',
          guildId: 'local',
          isIdle: false,
          track: null,
          ambience: ['amb-1'],
          source: 'live',
        },
      ] as never
      await flushPromises()
      releasePlay()
      await flushPromises()

      expect(stopAmbience).toHaveBeenCalledTimes(2)
    })

    it('a Scene Stop while a renderer-fallback Ambience is loading leaves its element paused and unplayed', async () => {
      vi.mocked(canDecode).mockResolvedValue(false)
      const store = useScenePlaybackStore()

      const starting = store.playScene({
        ...scene,
        createdAt: '',
        updatedAt: '',
        music: [],
      })
      await vi.waitFor(() => expect(loadingEls).toHaveLength(1))
      const el = loadingEls[0]!
      store.stopScene()
      el.dispatchEvent(new Event('canplaythrough'))
      await starting

      expect(playingEls).toEqual([])
      expect(pausedEls).toContain(el)
      expect(store.playingAmbienceIds.size).toBe(0)
    })

    it('a newer play of the same Ambience is not stopped by the superseded one landing', async () => {
      const store = useScenePlaybackStore()
      const item = { ...scene.ambience[0] }
      let releasePlay!: () => void
      vi.mocked(playAmbience).mockReturnValueOnce(new Promise<void>((resolve) => {
        releasePlay = resolve
      }))

      store.toggleAmbience(item)
      await vi.waitFor(() => expect(playAmbience).toHaveBeenCalledTimes(1))
      store.toggleAmbience({ ...item, enabled: false })
      store.toggleAmbience(item)
      await vi.waitFor(() => expect(playAmbience).toHaveBeenCalledTimes(2))
      releasePlay()
      await flushPromises()

      expect(store.playingAmbienceIds.has('amb-1')).toBe(true)
      expect(stopAmbience).toHaveBeenCalledTimes(1)
    })

    it('renderer-fallback Ambience toggled off while its element is loading never plays', async () => {
      vi.mocked(canDecode).mockResolvedValue(false)
      const store = useScenePlaybackStore()
      const item = { ...scene.ambience[0] }

      store.toggleAmbience(item)
      await vi.waitFor(() => expect(loadingEls).toHaveLength(1))
      const el = loadingEls[0]!
      store.toggleAmbience({ ...item, enabled: false })
      el.dispatchEvent(new Event('canplaythrough'))
      await flushPromises()

      expect(playingEls).toEqual([])
      expect(pausedEls).toContain(el)
      expect(store.playingAmbienceIds.has('amb-1')).toBe(false)
    })

    it('a Scene Crossfade while a renderer-fallback Ambience of the outgoing Scene is loading stops it (#712)', async () => {
      vi.mocked(canDecode).mockResolvedValue(false)
      joinDiscordTarget()
      const { getScene } = await import('@/api/scenes')
      vi.mocked(getScene).mockResolvedValue({
        ...scene,
        id: 's2',
        name: 'Tavern',
        ambience: [],
        music: [],
        createdAt: '',
        updatedAt: '',
      })
      const store = useScenePlaybackStore()

      const starting = store.playScene({
        ...scene,
        createdAt: '',
        updatedAt: '',
        music: [],
      })
      await vi.waitFor(() => expect(loadingEls).toHaveLength(1))
      const el = loadingEls[0]!
      vi.mocked(stopEffectStream).mockClear()
      await store.crossfadeToScene('s2')
      el.dispatchEvent(new Event('canplaythrough'))
      await starting
      await flushPromises()

      expect(playingEls).toEqual([])
      expect(pausedEls).toContain(el)
      expect(stopEffectStream).toHaveBeenCalledWith('guild-1', 'ambience-amb-1')
      expect(store.playingAmbienceIds.has('amb-1')).toBe(false)
    })

    it('a renderer-fallback Ambience streamed to a Discord Target opens its mixer input at full volume (#711)', async () => {
      vi.mocked(canDecode).mockResolvedValue(false)
      joinDiscordTarget()
      const store = useScenePlaybackStore()

      store.toggleAmbience({ ...scene.ambience[0] })
      await vi.waitFor(() => expect(loadingEls).toHaveLength(1))

      expect(startEffectStream).toHaveBeenCalledWith('guild-1', 'ambience-amb-1', 100)
      store.toggleAmbience({ ...scene.ambience[0], enabled: false })
    })

    it('a renderer-fallback Effect streamed to a Discord Target opens its mixer input at full volume (#711)', async () => {
      vi.mocked(canDecode).mockResolvedValue(false)
      joinDiscordTarget()
      const store = useScenePlaybackStore()

      const playing = store.playEffect(scene.effects[0])
      await vi.waitFor(() => expect(loadingEls).toHaveLength(1))

      expect(startEffectStream).toHaveBeenCalledWith('guild-1', expect.any(String), 100)
      store.stopAllEffectInstances()
      loadingEls[0]!.dispatchEvent(new Event('canplaythrough'))
      await playing
    })

    it('an Effect whose element is still loading when all Effects stop never plays', async () => {
      vi.mocked(canDecode).mockResolvedValue(false)
      const store = useScenePlaybackStore()

      const playing = store.playEffect(scene.effects[0])
      await vi.waitFor(() => expect(loadingEls).toHaveLength(1))
      const el = loadingEls[0]!
      store.stopAllEffectInstances()
      el.dispatchEvent(new Event('canplaythrough'))
      await playing

      expect(playingEls).toEqual([])
      expect(usePlayerStore().activeEffectCount()).toBe(0)
    })
  })

  it('steps the master volume from the stored value, clamped, and persists it', async () => {
    const store = useScenePlaybackStore()
    vi.mocked(fetchMasterVolume).mockResolvedValueOnce(65)
    expect(await store.stepMasterVolume(5)).toBe(70)
    expect(updateMasterVolume).toHaveBeenLastCalledWith('local', 70)
    vi.mocked(fetchMasterVolume).mockResolvedValueOnce(100)
    expect(await store.stepMasterVolume(5)).toBeNull()
    vi.mocked(fetchMasterVolume).mockResolvedValueOnce(2)
    expect(await store.stepMasterVolume(-5)).toBe(0)
  })
})

describe('scene playback store: master volume reaches the Playing Scene', () => {
  const otherScene: Scene = {
    id: 's2',
    name: 'Tavern',
    ambience: [
      {
        soundId: 'amb-9',
        soundName: 'Fire',
        volume: 30,
        enabled: true,
      },
    ],
    music: [
      { soundId: 'mus-9', soundName: 'Lute', volume: 30 },
    ],
    effects: [],
    createdAt: '',
    updatedAt: '',
  }

  const mediaProto = HTMLMediaElement.prototype
  const originalMedia = { load: mediaProto.load, play: mediaProto.play, pause: mediaProto.pause }
  let playingEls: HTMLMediaElement[]

  async function playStorm() {
    const store = useScenePlaybackStore()
    store.masterVolume = 60
    store.musicSounds = [
      { id: 'mus-1', name: 'Theme', filename: 'theme.mp3' },
    ] as never
    await store.playScene({
      ...scene,
      createdAt: '',
      updatedAt: '',
    })
    await flushPromises()
    return store
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    usePlayerStore().activeTarget = 'local'
    vi.mocked(fetchMasterVolume).mockResolvedValue(60)
    playingEls = []
    Object.defineProperty(mediaProto, 'load', {
      configurable: true,
      value(this: HTMLMediaElement) {
        queueMicrotask(() => this.dispatchEvent(new Event('canplaythrough')))
      },
    })
    Object.defineProperty(mediaProto, 'play', {
      configurable: true,
      value(this: HTMLMediaElement) {
        playingEls.push(this)
        return Promise.resolve()
      },
    })
    Object.defineProperty(mediaProto, 'pause', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalMedia))
      Object.defineProperty(mediaProto, key, { configurable: true, value })
    vi.mocked(canDecode).mockResolvedValue(true)
    vi.mocked(fetchMasterVolume).mockResolvedValue(50)
  })

  it('a Volume hotkey step with no Scene open rescales every playing item of the Playing Scene', async () => {
    const store = await playStorm()
    store.openScene = null

    expect(await store.stepMasterVolume(-10)).toBe(50)
    await flushPromises()

    expect(setMusicVolume).toHaveBeenCalledWith('local', 50)
    expect(setAmbienceVolume).toHaveBeenCalledWith('local', 'amb-1', 40)
  })

  it('a master change while a different Scene is open rescales the Playing Scene, not the open one', async () => {
    const store = await playStorm()
    store.openScene = otherScene

    store.masterVolume = 50
    await flushPromises()

    expect(setMusicVolume).toHaveBeenCalledTimes(1)
    expect(setMusicVolume).toHaveBeenCalledWith('local', 50)
    expect(vi.mocked(setAmbienceVolume).mock.calls).toEqual([
      ['local', 'amb-1', 40],
    ])
  })

  it('a per-item volume edit sticks for later master changes', async () => {
    const store = await playStorm()
    store.updateAmbienceVolume({ ...scene.ambience[0]!, volume: 20 })
    store.updateMusicVolume({ ...scene.music[0]!, volume: 40 })
    store.openScene = null
    vi.clearAllMocks()

    store.masterVolume = 50
    await flushPromises()

    expect(setMusicVolume).toHaveBeenCalledWith('local', 20)
    expect(setAmbienceVolume).toHaveBeenCalledWith('local', 'amb-1', 10)
  })

  it('renderer-fallback elements follow a master change with no Scene open', async () => {
    vi.mocked(canDecode).mockResolvedValue(false)
    const store = await playStorm()
    expect(playingEls).toHaveLength(2)
    store.openScene = null

    store.masterVolume = 50
    await flushPromises()

    const [ambienceEl, musicEl] = playingEls
    expect(ambienceEl!.volume).toBeCloseTo(0.4)
    expect(musicEl!.volume).toBeCloseTo(0.5)
    expect(setMusicVolume).not.toHaveBeenCalled()
    expect(setAmbienceVolume).not.toHaveBeenCalled()
  })
})

describe('scene playback store: Scene Crossfade back to a Scene whose Ambience is fading out', () => {
  const FADE_MS = 300
  const storm: Scene = {
    ...scene,
    music: [],
    createdAt: '',
    updatedAt: '',
  }
  const tavern: Scene = {
    ...storm,
    id: 's2',
    name: 'Tavern',
    ambience: [],
  }

  const mediaProto = HTMLMediaElement.prototype
  const originalMedia = { load: mediaProto.load, play: mediaProto.play, pause: mediaProto.pause }
  let playingEls: HTMLMediaElement[]
  let pausedEls: HTMLMediaElement[]

  beforeEach(async () => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    usePlayerStore().activeTarget = 'local'
    vi.mocked(canDecode).mockResolvedValue(false)
    vi.mocked(fetchSceneFadeLength).mockResolvedValue(FADE_MS / 1000)
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockImplementation(async id => id === 's2'
      ? tavern
      : storm)
    playingEls = []
    pausedEls = []
    Object.defineProperty(mediaProto, 'load', {
      configurable: true,
      value(this: HTMLMediaElement) {
        queueMicrotask(() => this.dispatchEvent(new Event('canplaythrough')))
      },
    })
    Object.defineProperty(mediaProto, 'play', {
      configurable: true,
      value(this: HTMLMediaElement) {
        playingEls.push(this)
        return Promise.resolve()
      },
    })
    Object.defineProperty(mediaProto, 'pause', {
      configurable: true,
      value(this: HTMLMediaElement) {
        pausedEls.push(this)
      },
    })
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalMedia))
      Object.defineProperty(mediaProto, key, { configurable: true, value })
    vi.mocked(canDecode).mockResolvedValue(true)
    vi.mocked(fetchSceneFadeLength).mockResolvedValue(0)
  })

  it('a renderer-fallback Ambience fading out is brought back and keeps playing', async () => {
    const store = useScenePlaybackStore()
    store.masterVolume = 50
    await store.playScene(storm)
    await flushPromises()
    expect(playingEls).toHaveLength(1)
    const el = playingEls[0]!
    pausedEls = []

    await store.crossfadeToScene('s2')
    await store.crossfadeToScene('s1')
    // Past the end of the out-fade the first switch started.
    await new Promise(resolve => setTimeout(resolve, FADE_MS * 2))
    await flushPromises()

    expect(store.playingAmbienceIds.has('amb-1')).toBe(true)
    expect(pausedEls).not.toContain(el)
    // Item volume 80 at master volume 50.
    expect(el.volume).toBeCloseTo(0.4)
  })
})

describe('scene playback store: Music Mode', () => {
  const track = (id: string) => ({
    soundId: id,
    soundName: id,
    volume: 100,
    loop: true,
  })
  const musicScene = (mode: Scene['musicMode'], ids = ['m1', 'm2', 'm3'], id = 'sm'): Scene => ({
    id,
    name: `Scene ${id}`,
    ambience: [],
    music: ids.map(track),
    effects: [],
    musicMode: mode,
    createdAt: '',
    updatedAt: '',
  })

  const mediaProto = HTMLMediaElement.prototype
  const originalMedia = { load: mediaProto.load, play: mediaProto.play, pause: mediaProto.pause }
  let playingEls: HTMLMediaElement[]

  function setup(scene: Scene) {
    const store = useScenePlaybackStore()
    store.masterVolume = 100
    store.musicSounds = ['m1', 'm2', 'm3', 'm4', 'x1', 'x2'].map(id => ({ id, name: id, filename: `${id}.mp3` })) as never
    store.openScene = scene
    return store
  }

  // The backend's state push for the Local Target, as `player:stateChanged` would deliver it.
  async function backendTrack(id: string | null) {
    usePlayerStore().playerState = [
      {
        targetId: 'local',
        kind: 'local',
        guildId: 'local',
        isIdle: id === null,
        track: id
          ? {
              id,
              name: id,
              filename: `${id}.mp3`,
              category: 'music',
            }
          : null,
        source: 'live',
      },
    ] as never
    await flushPromises()
  }

  async function playsOut(id: string) {
    await backendTrack(id)
    await backendTrack(null)
  }

  const startedTracks = () => vi.mocked(playMusic).mock.calls.map(c => c[1])

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    usePlayerStore().activeTarget = 'local'
    vi.mocked(canDecode).mockResolvedValue(true)
    vi.mocked(fetchSceneFadeLength).mockResolvedValue(2)
    playingEls = []
    Object.defineProperty(mediaProto, 'load', {
      configurable: true,
      value(this: HTMLMediaElement) {
        queueMicrotask(() => this.dispatchEvent(new Event('canplaythrough')))
      },
    })
    Object.defineProperty(mediaProto, 'play', {
      configurable: true,
      value(this: HTMLMediaElement) {
        playingEls.push(this)
        return Promise.resolve()
      },
    })
    Object.defineProperty(mediaProto, 'pause', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalMedia))
      Object.defineProperty(mediaProto, key, { configurable: true, value })
    vi.mocked(canDecode).mockResolvedValue(true)
    vi.mocked(fetchSceneFadeLength).mockResolvedValue(0)
    vi.mocked(playMusic).mockResolvedValue(undefined)
  })

  it('plays a Scene without a Music Mode exactly as before: first track, Loop honoured, no advance', async () => {
    const scene = musicScene(undefined)
    const store = setup(scene)
    await store.playScene(scene)
    expect(playMusic).toHaveBeenCalledWith('local', 'm1', expect.objectContaining({ loop: true, fadeInMs: 0 }))

    await playsOut('m1')
    expect(startedTracks()).toEqual(['m1'])
  })

  it('sequential: a played-out track starts the next with the Scene fade-in, wrapping last to first, Loop ignored', async () => {
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    expect(playMusic).toHaveBeenLastCalledWith('local', 'm1', expect.objectContaining({ loop: false }))

    await playsOut('m1')
    expect(playMusic).toHaveBeenLastCalledWith('local', 'm2', expect.objectContaining({ loop: false, fadeInMs: 2000 }))
    await playsOut('m2')
    await playsOut('m3')
    expect(startedTracks()).toEqual(['m1', 'm2', 'm3', 'm1'])
    expect(store.playingMusicId).toBe('m1')
    expect(store.musicSceneId).toBe('sm')
    expect(scene.music[0]!.loop).toBe(true)
  })

  it('hard-cuts the advance when the fade length is 0', async () => {
    vi.mocked(fetchSceneFadeLength).mockResolvedValue(0)
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    await playsOut('m1')
    expect(playMusic).toHaveBeenLastCalledWith('local', 'm2', expect.objectContaining({ fadeInMs: 0 }))
  })

  it('shuffle: plays every track once per pass, and a one-track Scene repeats it', async () => {
    const scene = musicScene('shuffle')
    const store = setup(scene)
    await store.playScene(scene)
    for (let i = 0; i < 5; i++)
      await playsOut(startedTracks().at(-1)!)
    const played = startedTracks()
    expect(played.slice(0, 3).sort()).toEqual(['m1', 'm2', 'm3'])
    expect(played.slice(3, 6).sort()).toEqual(['m1', 'm2', 'm3'])
    expect(played[3]).not.toBe(played[2])

    vi.mocked(playMusic).mockClear()
    const solo = musicScene('shuffle', ['m4'], 'solo')
    store.openScene = solo
    await store.playScene(solo)
    await playsOut('m4')
    expect(startedTracks()).toEqual(['m4', 'm4'])
  })

  it('never advances after a Stop, the Music card Stop or a Target switch', async () => {
    const scene = musicScene('sequential')
    const store = setup(scene)

    await store.playScene(scene)
    await backendTrack('m1')
    store.stopScene()
    await backendTrack(null)

    await store.playScene(scene)
    await backendTrack('m1')
    store.stopMusicPlayback()
    await backendTrack(null)

    await store.playScene(scene)
    await backendTrack('m1')
    await store.switchTarget('discord')
    await backendTrack(null)

    expect(startedTracks()).toEqual(['m1', 'm1', 'm1'])
  })

  it('a Stop landing while an advance is still in flight wins: nothing starts afterwards', async () => {
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    let releaseFade!: (seconds: number) => void
    vi.mocked(fetchSceneFadeLength).mockReturnValueOnce(new Promise((resolve) => {
      releaseFade = resolve
    }))
    await playsOut('m1')
    store.stopScene()
    releaseFade(2)
    await flushPromises()
    expect(startedTracks()).toEqual(['m1'])
    expect(store.playingMusicId).toBeNull()
  })

  it('a Scene Crossfade away never advances the outgoing Scene', async () => {
    const scene = musicScene('sequential')
    const other = musicScene('sequential', ['x1', 'x2'], 'other')
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue(other)
    const store = setup(scene)
    await store.playScene(scene)
    await backendTrack('m1')

    await store.crossfadeToScene('other')
    await flushPromises()
    await backendTrack('x1')
    expect(startedTracks()).toEqual(['m1', 'x1'])
    expect(store.musicSceneId).toBe('other')

    await backendTrack(null)
    expect(startedTracks()).toEqual(['m1', 'x1', 'x2'])
  })

  it.each([
    [
      'in order',
      [0, 1],
    ],
    [
      'newest first',
      [1, 0],
    ],
  ])('a second Scene Crossfade before the first one\'s backend play lands leaves the newest track primary and advancing, plays landing %s (#712)', async (_order, landing) => {
    const sceneA = musicScene('sequential', ['m1'], 'sa')
    const sceneB = musicScene('sequential', ['m2', 'm3'], 'sb')
    const sceneC = musicScene('sequential', ['x1', 'x2'], 'sc')
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockImplementation(async id => id === 'sb'
      ? sceneB
      : sceneC)
    const store = setup(sceneA)
    store.musicSounds = store.musicSounds.map(s => ({ ...s, durationMs: 60_000 }))
    await store.playScene(sceneA)
    await backendTrack('m1')
    const held: (() => void)[] = []
    const holdPlay = () => vi.mocked(playMusic).mockReturnValueOnce(new Promise<void>((resolve) => {
      held.push(resolve)
    }))
    holdPlay()
    holdPlay()

    await store.crossfadeToScene('sb')
    await vi.waitFor(() => expect(startedTracks()).toEqual(['m1', 'm2']))
    await store.crossfadeToScene('sc')
    await vi.waitFor(() => expect(startedTracks()).toEqual(['m1', 'm2', 'x1']))
    for (const i of landing) {
      held[i]!()
      await flushPromises()
    }

    expect(store.playingMusicId).toBe('x1')
    expect(store.musicSceneId).toBe('sc')
    expect(store.musicProgress?.soundId).toBe('x1')
    expect(startedTracks()).toEqual(['m1', 'm2', 'x1'])

    await playsOut('x1')
    expect(startedTracks()).toEqual(['m1', 'm2', 'x1', 'x2'])
    store.stopScene()
  })

  it('three Scene Crossfades within one backend play, landing newest first, leave the newest track primary (#712)', async () => {
    const sceneA = musicScene('sequential', ['m1'], 'sa')
    const scenes: Record<string, Scene> = {
      sb: musicScene('sequential', ['m2'], 'sb'),
      sc: musicScene('sequential', ['m3'], 'sc'),
      sd: musicScene('sequential', ['x1', 'x2'], 'sd'),
    }
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockImplementation(async id => scenes[id]!)
    const store = setup(sceneA)
    store.musicSounds = store.musicSounds.map(s => ({ ...s, durationMs: 60_000 }))
    await store.playScene(sceneA)
    await backendTrack('m1')
    const held: (() => void)[] = []
    for (let i = 0; i < 3; i++) {
      vi.mocked(playMusic).mockReturnValueOnce(new Promise<void>((resolve) => {
        held.push(resolve)
      }))
    }

    await store.crossfadeToScene('sb')
    await vi.waitFor(() => expect(startedTracks()).toEqual(['m1', 'm2']))
    await store.crossfadeToScene('sc')
    await vi.waitFor(() => expect(startedTracks()).toEqual(['m1', 'm2', 'm3']))
    await store.crossfadeToScene('sd')
    await vi.waitFor(() => expect(startedTracks()).toEqual(['m1', 'm2', 'm3', 'x1']))
    for (const i of [2, 1, 0]) {
      held[i]!()
      await flushPromises()
    }

    expect(store.playingMusicId).toBe('x1')
    expect(store.musicSceneId).toBe('sd')
    expect(store.musicProgress?.soundId).toBe('x1')

    await playsOut('x1')
    expect(startedTracks()).toEqual(['m1', 'm2', 'm3', 'x1', 'x2'])
    store.stopScene()
  })

  it('a jump crossfades to the clicked track and the sequence continues from it', async () => {
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    await backendTrack('m1')

    await store.playMusicTrack(scene.music[2]!)
    expect(playMusic).toHaveBeenLastCalledWith('local', 'm3', expect.objectContaining({ fadeInMs: 2000 }))
    await backendTrack('m3')
    await backendTrack(null)
    expect(startedTracks()).toEqual(['m1', 'm3', 'm1'])
  })

  it('a track Play with nothing of the Scene playing is a plain start, not a jump', async () => {
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playMusicTrack(scene.music[1]!)
    expect(playMusic).toHaveBeenLastCalledWith('local', 'm2', expect.objectContaining({ fadeInMs: 0, loop: false }))
    await playsOut('m2')
    expect(startedTracks()).toEqual(['m2', 'm3'])
  })

  it('reads the live Music list at advance time; an emptied list ends Music after the current track', async () => {
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    scene.music.splice(1, 1)
    await playsOut('m1')
    expect(startedTracks()).toEqual(['m1', 'm3'])

    scene.music.splice(0)
    await playsOut('m3')
    expect(startedTracks()).toEqual(['m1', 'm3'])
    expect(store.playingMusicId).toBeNull()
    expect(store.musicSceneId).toBeNull()
  })

  it('follows the source Scene from the store when it is not the open Scene', async () => {
    const scene = musicScene('sequential')
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue({
      ...scene,
      music: [
        track('m1'),
        track('m4'),
      ],
    })
    const store = setup(scene)
    await store.playScene(scene)
    store.openScene = null
    await playsOut('m1')
    expect(getScene).toHaveBeenCalledWith('sm')
    expect(startedTracks()).toEqual(['m1', 'm4'])
  })

  it('skips a track that cannot start with a warning, and goes silent with a warning when none can', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    vi.mocked(playMusic).mockImplementation(async (_t, id) => {
      if (id === 'm2')
        throw new Error('decode failed')
    })
    await playsOut('m1')
    expect(startedTracks()).toEqual(['m1', 'm2', 'm3'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipping track m2'))

    vi.mocked(playMusic).mockRejectedValue(new Error('decode failed'))
    await playsOut('m3')
    expect(startedTracks()).toEqual(['m1', 'm2', 'm3', 'm1', 'm2', 'm3'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Music goes silent'))
    expect(store.playingMusicId).toBeNull()
    vi.restoreAllMocks()
  })

  it('advances across the backend and the renderer fallback in both directions', async () => {
    vi.mocked(canDecode).mockImplementation(async (_c, id) => id !== 'm2')
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    await playsOut('m1')
    expect(store.playingMusicId).toBe('m2')
    const m2El = playingEls.at(-1)!
    expect(m2El.src).toContain('m2')
    expect(m2El.loop).toBe(false)

    m2El.onended?.(new Event('ended'))
    await flushPromises()
    expect(startedTracks()).toEqual(['m1', 'm3'])
    expect(store.playingMusicId).toBe('m3')
  })

  it('a renderer end event from a stopped or replaced track never advances', async () => {
    vi.mocked(canDecode).mockResolvedValue(false)
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    const m1El = playingEls.at(-1)!
    const staleEnded = m1El.onended!

    await store.playMusicTrack(scene.music[2]!)
    await flushPromises()
    staleEnded.call(m1El, new Event('ended'))
    await flushPromises()
    expect(playingEls.map(el => el.src.split('/').at(-1))).toEqual(['m1', 'm3'])

    store.stopScene()
    staleEnded.call(m1El, new Event('ended'))
    await flushPromises()
    expect(playingEls).toHaveLength(2)
    expect(store.playingMusicId).toBeNull()
  })

  it('an element error on streamed renderer-fallback Music ends its capture session and Discord stream (#713)', async () => {
    vi.mocked(canDecode).mockResolvedValue(false)
    const player = usePlayerStore()
    player.activeTarget = 'discord'
    player.guildId = 'g1'
    player.playerState = [
      { guildId: 'g1', connectedChannelId: 'c1' },
    ] as never
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    const el = playingEls.at(-1)!
    const sess = await vi.mocked(captureFromAudioElement).mock.results.at(-1)!.value as { stop: ReturnType<typeof vi.fn> }
    expect(store.playingMusicId).toBe('m1')

    el.onerror?.(new Event('error'))
    await flushPromises()

    expect(sess.stop).toHaveBeenCalled()
    expect(stopAudioStream).toHaveBeenCalledWith('g1', 'music-a')
    expect(store.playingMusicId).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[scene] music m1 errored mid-play'))
    warn.mockRestore()
  })

  it('a streamed renderer-fallback Music start that fails to load ends its Discord stream (#713)', async () => {
    vi.mocked(canDecode).mockResolvedValue(false)
    const player = usePlayerStore()
    player.activeTarget = 'discord'
    player.guildId = 'g1'
    player.playerState = [
      { guildId: 'g1', connectedChannelId: 'c1' },
    ] as never
    Object.defineProperty(mediaProto, 'load', {
      configurable: true,
      value(this: HTMLMediaElement) {
        if (this.getAttribute('src'))
          queueMicrotask(() => this.dispatchEvent(new Event('error')))
      },
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = setup(musicScene('sequential'))

    await store.playMusic(track('m1'))

    expect(stopAudioStream).toHaveBeenCalledWith('g1', 'music-a')
    expect(store.playingMusicId).toBeNull()
    error.mockRestore()
  })

  it('a stale element error from a replaced track leaves the channel alone (#713)', async () => {
    vi.mocked(canDecode).mockResolvedValue(false)
    const scene = musicScene('sequential')
    const store = setup(scene)
    await store.playScene(scene)
    const staleError = playingEls.at(-1)!.onerror!

    await store.playMusicTrack(scene.music[2]!)
    await flushPromises()
    staleError.call(playingEls[0]!, new Event('error'))
    await flushPromises()

    expect(store.playingMusicId).toBe('m3')
  })

  describe('progress timer (#695)', () => {
    beforeEach(() => {
      // Frozen at the real now, never rewound: a crossfade an earlier test left
      // ticking on a real interval reads this Date, and a clock behind its start
      // would ramp an element's volume out of range (IndexSizeError).
      const now = Date.now()
      vi.useFakeTimers({
        toFake: ['Date', 'setInterval', 'clearInterval'],
      })
      vi.setSystemTime(now)
    })

    afterEach(() => {
      vi.useRealTimers()
      delete (mediaProto as { duration?: number }).duration
    })

    function withDurations(store: ReturnType<typeof setup>, durations: Record<string, number>) {
      store.musicSounds = store.musicSounds.map(s => ({ ...s, durationMs: durations[s.id] }))
    }

    it('shows elapsed / total of the playing track from its known duration, restarting at the advance', async () => {
      const scene = musicScene('sequential')
      const store = setup(scene)
      withDurations(store, { m1: 184_000, m2: 90_000 })
      await store.playScene(scene)
      expect(store.musicProgress).toEqual({ soundId: 'm1', elapsedMs: 0, totalMs: 184_000 })

      vi.advanceTimersByTime(65_000)
      expect(store.musicProgress).toEqual({ soundId: 'm1', elapsedMs: 65_000, totalMs: 184_000 })

      await playsOut('m1')
      expect(store.musicProgress).toEqual({ soundId: 'm2', elapsedMs: 0, totalMs: 90_000 })
    })

    it('a looping single track wraps; a non-looping one holds at its total', async () => {
      const looping = musicScene(undefined)
      const store = setup(looping)
      withDurations(store, { m1: 10_000, m2: 10_000 })
      await store.playScene(looping)
      vi.advanceTimersByTime(23_000)
      expect(store.musicProgress?.elapsedMs).toBe(3_000)

      store.stopScene()
      const once = musicScene('sequential', ['m2'])
      store.openScene = once
      await store.playScene(once)
      vi.advanceTimersByTime(12_000)
      expect(store.musicProgress?.elapsedMs).toBe(10_000)
    })

    it('has no timer for a track whose duration is unknown, and none once Music stops', async () => {
      const scene = musicScene('sequential')
      const store = setup(scene)
      withDurations(store, { m2: 90_000 })
      await store.playScene(scene)
      expect(store.playingMusicId).toBe('m1')
      expect(store.musicProgress).toBeNull()

      await store.playMusicTrack(scene.music[1]!)
      expect(store.musicProgress?.soundId).toBe('m2')
      store.stopMusicPlayback()
      expect(store.musicProgress).toBeNull()
    })

    it('the renderer fallback reads the duration off its audio element when none is stored', async () => {
      vi.mocked(canDecode).mockResolvedValue(false)
      Object.defineProperty(mediaProto, 'duration', {
        configurable: true,
        get: () => 42.5,
      })
      const scene = musicScene('sequential')
      const store = setup(scene)
      await store.playScene(scene)
      expect(store.musicProgress).toEqual({ soundId: 'm1', elapsedMs: 0, totalMs: 42_500 })
    })
  })
})

describe('scene playback store: Usage Stats', () => {
  const statsScene: Scene = {
    id: 'st',
    name: 'Tavern',
    ambience: [
      {
        soundId: 'amb-1',
        soundName: 'Rain',
        volume: 80,
        enabled: true,
      },
      {
        soundId: 'amb-2',
        soundName: 'Fire',
        volume: 80,
        enabled: false,
      },
    ],
    music: [
      {
        soundId: 'mus-1',
        soundName: 'Theme',
        volume: 100,
        loop: true,
      },
    ],
    effects: [
      { soundId: 'fx-1', soundName: 'Thunder', volume: 100 },
      { soundId: 'fx-2', soundName: 'Door', volume: 100 },
      { soundId: 'fx-3', soundName: 'Bell', volume: 100 },
    ],
    musicMode: 'shuffle',
    createdAt: '',
    updatedAt: '',
  }

  function joinDiscord() {
    const player = usePlayerStore()
    player.guildId = 'g1'
    player.playerState = [
      { guildId: 'g1', connectedChannelId: 'c1' },
    ] as never
  }

  const events = (name: string) => vi.mocked(trackUsage).mock.calls.map(([event]) => event).filter(event => event.name === name)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    usePlayerStore().activeTarget = 'local'
  })

  it('emits one scene-play per Scene start with the mode, item counts and Target kind, never names', async () => {
    const store = useScenePlaybackStore()
    store.musicSounds = [
      { id: 'mus-1', name: 'Theme', filename: 'theme.mp3' } as never,
    ]

    await store.playScene(statsScene)

    expect(events('scene-play')).toEqual([
      {
        name: 'scene-play',
        data: {
          musicMode: 'shuffle',
          music: 1,
          ambience: 2,
          effects: 3,
          target: 'local',
        },
      },
    ])
  })

  it('emits scene-play for a Scene Crossfade too', async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue({ ...statsScene, musicMode: undefined })
    const store = useScenePlaybackStore()

    await store.crossfadeToScene('st')

    expect(events('scene-play')).toEqual([
      {
        name: 'scene-play',
        data: {
          musicMode: 'single',
          music: 1,
          ambience: 2,
          effects: 3,
          target: 'local',
        },
      },
    ])
  })

  it('emits nothing when the Scene cannot play', async () => {
    usePlayerStore().activeTarget = 'discord'
    await useScenePlaybackStore().playScene(statsScene)
    expect(trackUsage).not.toHaveBeenCalled()
  })

  it('a Target handover emits target-switch and no second scene-play', async () => {
    joinDiscord()
    usePlayerStore().activeTarget = 'discord'
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue(statsScene)
    const store = useScenePlaybackStore()
    await store.playScene(statsScene)

    await store.switchTarget('local')
    await flushPromises()

    expect(usePlayerStore().playingSceneMode).toBe('local')
    expect(events('scene-play')).toHaveLength(1)
    expect(events('scene-play')[0].data).toEqual(expect.objectContaining({ target: 'discord' }))
    expect(events('target-switch')).toEqual([
      {
        name: 'target-switch',
        data: { target: 'local' },
      },
    ])
  })

  it('switching to the Target already active emits nothing', async () => {
    await useScenePlaybackStore().switchTarget('local')
    expect(trackUsage).not.toHaveBeenCalled()
  })
})

describe('scene playback store: Effect cache warming (#696)', () => {
  const warmScene: Scene = {
    id: 'wm',
    name: 'Storm',
    ambience: [],
    music: [],
    effects: [
      { soundId: 'fx-1', soundName: 'Thunder', volume: 100 },
      { soundId: 'fx-2', soundName: 'Door', volume: 100 },
    ],
    createdAt: '',
    updatedAt: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    usePlayerStore().activeTarget = 'local'
  })

  it('warms a Scene\'s Effects in list order when it is opened, with or without a Target', async () => {
    usePlayerStore().activeTarget = 'discord'
    const store = useScenePlaybackStore()

    store.openScene = warmScene
    await flushPromises()

    expect(warmEffects).toHaveBeenCalledWith('wm', ['fx-1', 'fx-2'])
  })

  it('does not warm again when the open Scene is edited without touching its Effects', async () => {
    const store = useScenePlaybackStore()
    store.openScene = warmScene
    await flushPromises()

    store.openScene = { ...warmScene, name: 'Thunderstorm' }
    await flushPromises()
    store.openScene = null
    await flushPromises()

    expect(warmEffects).toHaveBeenCalledTimes(1)
  })

  it('warms again when an Effect is added to the open Scene', async () => {
    const store = useScenePlaybackStore()
    store.openScene = warmScene
    await flushPromises()

    store.openScene = {
      ...warmScene,
      effects: [
        ...warmScene.effects,
        { soundId: 'fx-3', volume: 100 },
      ],
    }
    await flushPromises()

    expect(warmEffects).toHaveBeenLastCalledWith('wm', ['fx-1', 'fx-2', 'fx-3'])
  })

  it('does not warm a Scene without Effects', async () => {
    const store = useScenePlaybackStore()
    store.openScene = { ...warmScene, effects: [] }
    await flushPromises()
    await store.playScene({ ...warmScene, effects: [] })

    expect(warmEffects).not.toHaveBeenCalled()
  })

  it('warms the Scene that becomes the Playing Scene through Play', async () => {
    await useScenePlaybackStore().playScene(warmScene)

    expect(warmEffects).toHaveBeenCalledWith('wm', ['fx-1', 'fx-2'])
  })

  it('warms the Scene that becomes the Playing Scene through a Scene Crossfade', async () => {
    const { getScene } = await import('@/api/scenes')
    vi.mocked(getScene).mockResolvedValue(warmScene)

    await useScenePlaybackStore().crossfadeToScene('wm')

    expect(warmEffects).toHaveBeenCalledWith('wm', ['fx-1', 'fx-2'])
  })

  it('a failed warm-up never gets in the way of playing the Scene', async () => {
    vi.mocked(warmEffects).mockRejectedValueOnce(new Error('IPC down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await useScenePlaybackStore().playScene(warmScene)
    await flushPromises()

    expect(usePlayerStore().playingSceneId).toBe('wm')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[scene]'), expect.any(Error))
    warn.mockRestore()
  })
})
