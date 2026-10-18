import { describe, expect, it } from 'vitest'
import { normalizeMusicMode, selectFirstTrack, selectNextTrack, shuffleBagWithout } from './music-mode'

// Deterministic stand-in for Math.random: replays `values` in order, then 0.
function seq(...values: number[]): () => number {
  let i = 0
  return () => values[i++] ?? 0
}

describe('normalizeMusicMode', () => {
  it('keeps the three modes and reads anything else as single', () => {
    expect(normalizeMusicMode('sequential')).toBe('sequential')
    expect(normalizeMusicMode('shuffle')).toBe('shuffle')
    expect(normalizeMusicMode('single')).toBe('single')
    expect(normalizeMusicMode(undefined)).toBe('single')
    expect(normalizeMusicMode('repeat-one')).toBe('single')
  })
})

describe('selectFirstTrack', () => {
  it('starts single and sequential on the first track', () => {
    expect(selectFirstTrack('single', ['a', 'b'])).toEqual({ soundId: 'a', index: 0, bag: [] })
    expect(selectFirstTrack('sequential', ['a', 'b'])).toEqual({ soundId: 'a', index: 0, bag: [] })
  })

  it('starts shuffle on a random track with a fresh bag holding the rest', () => {
    const first = selectFirstTrack('shuffle', ['a', 'b', 'c'], seq(0.99, 0.99))
    expect(first).not.toBeNull()
    expect(['a', 'b', 'c']).toContain(first!.soundId)
    expect([...first!.bag, first!.soundId].sort()).toEqual(['a', 'b', 'c'])
    expect(first!.index).toBe(['a', 'b', 'c'].indexOf(first!.soundId))
  })

  it('returns null for an empty list', () => {
    expect(selectFirstTrack('shuffle', [])).toBeNull()
    expect(selectFirstTrack('single', [])).toBeNull()
  })
})

describe('selectNextTrack', () => {
  it('never advances in single mode', () => {
    expect(selectNextTrack({ mode: 'single', list: ['a', 'b'], current: 'a', currentIndex: 0, bag: [] })).toBeNull()
  })

  it('returns null once the list is empty', () => {
    expect(selectNextTrack({ mode: 'sequential', list: [], current: 'a', currentIndex: 0, bag: [] })).toBeNull()
    expect(selectNextTrack({ mode: 'shuffle', list: [], current: 'a', currentIndex: 0, bag: ['b'] })).toBeNull()
  })

  describe('sequential', () => {
    it('moves to the next track and wraps from the last to the first', () => {
      expect(selectNextTrack({ mode: 'sequential', list: ['a', 'b', 'c'], current: 'a', currentIndex: 0, bag: [] }))
        .toEqual({ soundId: 'b', index: 1, bag: [] })
      expect(selectNextTrack({ mode: 'sequential', list: ['a', 'b', 'c'], current: 'c', currentIndex: 2, bag: [] }))
        .toEqual({ soundId: 'a', index: 0, bag: [] })
    })

    it('repeats a one-track list', () => {
      expect(selectNextTrack({ mode: 'sequential', list: ['a'], current: 'a', currentIndex: 0, bag: [] }))
        .toEqual({ soundId: 'a', index: 0, bag: [] })
    })

    it('follows a reorder of the live list', () => {
      expect(selectNextTrack({ mode: 'sequential', list: ['c', 'a', 'b'], current: 'a', currentIndex: 0, bag: [] }))
        .toEqual({ soundId: 'b', index: 2, bag: [] })
    })

    it('picks the track that slid into the removed current track\'s slot', () => {
      expect(selectNextTrack({ mode: 'sequential', list: ['a', 'c'], current: 'b', currentIndex: 1, bag: [] }))
        .toEqual({ soundId: 'c', index: 1, bag: [] })
      expect(selectNextTrack({ mode: 'sequential', list: ['a', 'b'], current: 'c', currentIndex: 2, bag: [] }))
        .toEqual({ soundId: 'a', index: 0, bag: [] })
    })
  })

  describe('shuffle', () => {
    it('takes the next track from the bag', () => {
      expect(selectNextTrack({ mode: 'shuffle', list: ['a', 'b', 'c'], current: 'a', currentIndex: 0, bag: ['c', 'b'] }))
        .toMatchObject({ soundId: 'c', index: 2, bag: ['b'] })
    })

    it('skips bag entries that left the live list', () => {
      expect(selectNextTrack({ mode: 'shuffle', list: ['a', 'b'], current: 'a', currentIndex: 0, bag: ['c', 'b'] }))
        .toMatchObject({ soundId: 'b', index: 1, bag: [] })
    })

    it('plays every track once per pass across many passes, never repeating at the seam', () => {
      const list = ['a', 'b', 'c', 'd']
      let state = selectFirstTrack('shuffle', list)!
      const played = [state.soundId]
      for (let i = 0; i < list.length * 50 - 1; i++) {
        state = selectNextTrack({ mode: 'shuffle', list, current: state.soundId, currentIndex: state.index, bag: state.bag })!
        played.push(state.soundId)
      }
      for (let pass = 0; pass < 50; pass++)
        expect(played.slice(pass * 4, pass * 4 + 4).sort()).toEqual(list)
      for (let i = 1; i < played.length; i++)
        expect(played[i]).not.toBe(played[i - 1])
    })

    it('reshuffles a new pass without starting on the track that just played', () => {
      // random 0 makes the Fisher-Yates shuffle rotate ['a','b'] to ['b','a'];
      // 0.99 makes it the identity, putting the just-played 'a' first, which must be swapped away.
      const next = selectNextTrack({ mode: 'shuffle', list: ['a', 'b'], current: 'a', currentIndex: 0, bag: [], random: seq(0.99, 0.99) })
      expect(next).toMatchObject({ soundId: 'b', index: 1, bag: ['a'] })
    })

    it('lets a track added mid-pass join the current pass', () => {
      const next = selectNextTrack({ mode: 'shuffle', list: ['a', 'b', 'c', 'n'], current: 'a', currentIndex: 0, bag: ['c'], pass: ['a', 'b', 'c'], random: () => 0 })
      expect(next).toEqual({ soundId: 'n', index: 3, bag: ['c'], pass: ['a', 'b', 'c', 'n'] })
    })

    it('repeats a one-track list', () => {
      expect(selectNextTrack({ mode: 'shuffle', list: ['a'], current: 'a', currentIndex: 0, bag: [] }))
        .toMatchObject({ soundId: 'a', index: 0, bag: [] })
    })
  })
})

describe('shuffleBagWithout', () => {
  it('holds every other track once', () => {
    expect(shuffleBagWithout(['a', 'b', 'c'], 'b').sort()).toEqual(['a', 'c'])
  })
})
