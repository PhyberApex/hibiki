import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMasterVolume, updateMasterVolume } from '@/api/config'
import { playAmbience, playEffect, playMusic, stopAmbience, stopEffects, stopMusic } from '@/api/player'
import { usePlayerStore } from '@/stores/player'
import { useScenePlaybackStore } from './scene-playback'

vi.mock('@/api/scenes', () => ({ getScene: vi.fn() }))
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
  ambience: [{ soundId: 'amb-1', soundName: 'Rain', volume: 80, enabled: true }],
  music: [{ soundId: 'mus-1', soundName: 'Theme', volume: 100, loop: true }],
  effects: [{ soundId: 'fx-1', soundName: 'Thunder', volume: 100 }],
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
    store.musicSounds = [{ id: 'mus-1', name: 'Theme', filename: 'theme.mp3' } as never]

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
    store.musicSounds = [{ id: 'mus-1', name: 'Theme', filename: 'theme.mp3' } as never]
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
