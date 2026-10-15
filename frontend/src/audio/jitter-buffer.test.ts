import { describe, expect, it } from 'vitest'
import { JitterBuffer } from './jitter-buffer'

const PACKET = 0.02

describe('jitterBuffer', () => {
  it('starts the first packet one buffer-length ahead and is not an underrun', () => {
    const jitter = new JitterBuffer(0.1)
    expect(jitter.schedule(1, PACKET)).toEqual({ kind: 'play', startAt: 1.1, underrun: false })
  })

  it('queues following packets back to back', () => {
    const jitter = new JitterBuffer(0.1)
    jitter.schedule(1, PACKET)
    const second = jitter.schedule(1.02, PACKET)
    expect(second).toMatchObject({ kind: 'play', underrun: false })
    expect((second as { startAt: number }).startAt).toBeCloseTo(1.12)
  })

  it('reports an underrun and refills the lead when the queue ran dry', () => {
    const jitter = new JitterBuffer(0.1)
    jitter.schedule(1, PACKET)
    const late = jitter.schedule(3, PACKET)
    expect(late).toEqual({ kind: 'play', startAt: 3.1, underrun: true })
  })

  it('drops a backlog that would add more than the maximum latency', () => {
    const jitter = new JitterBuffer(0.1, 0.5)
    jitter.schedule(1, 0.6)
    expect(jitter.schedule(1.01, PACKET)).toEqual({ kind: 'drop' })
  })

  it('tracks queued audio and forgets it on reset', () => {
    const jitter = new JitterBuffer(0.1)
    expect(jitter.queuedSec(0)).toBe(0)
    jitter.schedule(1, PACKET)
    expect(jitter.queuedSec(1)).toBeCloseTo(0.12)
    jitter.reset()
    expect(jitter.queuedSec(1)).toBe(0)
    expect(jitter.schedule(5, PACKET)).toMatchObject({ underrun: false, startAt: 5.1 })
  })
})
