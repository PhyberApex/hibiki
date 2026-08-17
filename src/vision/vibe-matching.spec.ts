import type { SoundFile } from '../sound/sound.types'
import { matchVibeTags } from './vibe-matching'

function sound(id: string, tags: string[], createdAt = '2026-01-01T00:00:00.000Z', category: SoundFile['category'] = 'music'): SoundFile {
  return { id, name: id, filename: `${id}.mp3`, size: 1, category, createdAt, tags }
}

describe('matchVibeTags', () => {
  it('ranks sounds by number of overlapping tags, highest first', () => {
    const sounds = [
      sound('one', ['tavern']),
      sound('two', ['tavern', 'warm', 'candlelit']),
      sound('three', ['tavern', 'warm']),
    ]
    const result = matchVibeTags(['tavern', 'warm', 'candlelit'], sounds)
    expect(result.map(m => m.sound.id)).toEqual(['two', 'three', 'one'])
    expect(result.map(m => m.score)).toEqual([3, 2, 1])
  })

  it('matches case-insensitively and by substring in either direction', () => {
    const sounds = [
      sound('storm', ['Stormy Coastline']),
      sound('cave', ['dark']),
    ]
    const result = matchVibeTags(['stormy', 'Dark Cave'], sounds)
    expect(result.map(m => m.sound.id).sort()).toEqual(['cave', 'storm'])
  })

  it('excludes sounds with zero overlap instead of ranking them last', () => {
    const sounds = [sound('hit', ['forest']), sound('miss', ['desert'])]
    const result = matchVibeTags(['forest'], sounds)
    expect(result.map(m => m.sound.id)).toEqual(['hit'])
  })

  it('never matches sounds with empty tags', () => {
    const sounds = [sound('untagged', []), sound('blank', ['   '])]
    expect(matchVibeTags(['forest', 'rain'], sounds)).toEqual([])
  })

  it('returns nothing when the vibe tags are empty', () => {
    expect(matchVibeTags([], [sound('a', ['forest'])])).toEqual([])
    expect(matchVibeTags(['', '  '], [sound('a', ['forest'])])).toEqual([])
  })

  it('caps results at 5 by default', () => {
    const sounds = Array.from({ length: 8 }, (_, i) => sound(`s${i}`, ['rain']))
    expect(matchVibeTags(['rain'], sounds)).toHaveLength(5)
  })

  it('honours a custom limit', () => {
    const sounds = Array.from({ length: 8 }, (_, i) => sound(`s${i}`, ['rain']))
    expect(matchVibeTags(['rain'], sounds, 2)).toHaveLength(2)
  })

  it('breaks ties by most recently created', () => {
    const sounds = [
      sound('old', ['rain'], '2025-01-01T00:00:00.000Z'),
      sound('new', ['rain'], '2026-01-01T00:00:00.000Z'),
    ]
    expect(matchVibeTags(['rain'], sounds).map(m => m.sound.id)).toEqual(['new', 'old'])
  })

  it('counts each vibe tag at most once per sound', () => {
    const sounds = [sound('multi', ['rain', 'rainy', 'raining'])]
    expect(matchVibeTags(['rain'], sounds)[0]!.score).toBe(1)
  })
})
