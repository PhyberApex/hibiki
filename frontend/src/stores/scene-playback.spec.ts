import type { Scene } from '@/api/scenes'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMasterVolume, fetchSceneFadeLength, updateMasterVolume } from '@/api/config'
import { playAmbience, playEffect, playMusic, stopAmbience, stopEffects, stopMusic } from '@/api/player'
import { canDecode } from '@/api/sounds'
import { trackUsage } from '@/api/usage-stats'
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
