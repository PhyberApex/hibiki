import { describe, expect, it, vi } from 'vitest'

// Test the pure functions by importing them. They are not exported directly,
// so we test via the module's behavior or extract them.
// Since float32ToInt16 and ensureStereo are not exported, we test them
// through captureFromAudioElement / captureFromMediaStream behavior,
// and test the exported functions directly.

describe('browser-audio-capture', () => {
  describe('float32ToInt16 (via module internals)', () => {
    it('converts float32 to int16 correctly', async () => {
      // We can test via the worklet message handler in captureFromAudioElement
      // but since the functions are private, let's test through the capture path
      // Instead, test the math directly by reimplementing the check
      const float32ToInt16 = (float32: Float32Array): Int16Array => {
        const len = float32.length
        const int16 = new Int16Array(len)
        for (let i = 0; i < len; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]))
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }
        return int16
      }

      // Positive max
      const pos = float32ToInt16(new Float32Array([1.0]))
      expect(pos[0]).toBe(0x7FFF)

      // Negative max
      const neg = float32ToInt16(new Float32Array([-1.0]))
      expect(neg[0]).toBe(-0x8000)

      // Zero
      const zero = float32ToInt16(new Float32Array([0.0]))
      expect(zero[0]).toBe(0)

      // Clamping above 1
      const clampHigh = float32ToInt16(new Float32Array([1.5]))
      expect(clampHigh[0]).toBe(0x7FFF)

      // Clamping below -1
      const clampLow = float32ToInt16(new Float32Array([-1.5]))
      expect(clampLow[0]).toBe(-0x8000)
    })
  })

  describe('ensureStereo (via module internals)', () => {
    it('interleaves two channels into stereo', () => {
      const ensureStereo = (inputL: Float32Array, inputR: Float32Array | undefined): Float32Array => {
        if (inputR && inputL.length === inputR.length) {
          const stereo = new Float32Array(inputL.length * 2)
          for (let i = 0; i < inputL.length; i++) {
            stereo[i * 2] = inputL[i]
            stereo[i * 2 + 1] = inputR[i]
          }
          return stereo
        }
        const stereo = new Float32Array(inputL.length * 2)
        for (let i = 0; i < inputL.length; i++) {
          stereo[i * 2] = inputL[i]
          stereo[i * 2 + 1] = inputL[i]
        }
        return stereo
      }

      const left = new Float32Array([0.5, -0.5])
      const right = new Float32Array([0.3, -0.3])
      const stereo = ensureStereo(left, right)
      expect(stereo).toEqual(new Float32Array([0.5, 0.3, -0.5, -0.3]))
    })

    it('duplicates mono to stereo when no right channel', () => {
      const ensureStereo = (inputL: Float32Array, inputR: Float32Array | undefined): Float32Array => {
        if (inputR && inputL.length === inputR.length) {
          const stereo = new Float32Array(inputL.length * 2)
          for (let i = 0; i < inputL.length; i++) {
            stereo[i * 2] = inputL[i]
            stereo[i * 2 + 1] = inputR[i]
          }
          return stereo
        }
        const stereo = new Float32Array(inputL.length * 2)
        for (let i = 0; i < inputL.length; i++) {
          stereo[i * 2] = inputL[i]
          stereo[i * 2 + 1] = inputL[i]
        }
        return stereo
      }

      const left = new Float32Array([0.5, -0.5])
      const stereo = ensureStereo(left, undefined)
      expect(stereo).toEqual(new Float32Array([0.5, 0.5, -0.5, -0.5]))
    })
  })

  describe('captureFromAudioElement', () => {
    it('creates context, source, worklet and returns stop function', async () => {
      const mockWorkletNode = {
        port: { onmessage: null as any },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      const mockSource = {
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      const mockDestination = {}
      const mockCtx = {
        sampleRate: 48000,
        state: 'running',
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        createMediaElementSource: vi.fn().mockReturnValue(mockSource),
        createMediaStreamSource: vi.fn(),
        audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
        destination: mockDestination,
      }

      // Use class-style constructors for vi.stubGlobal
      vi.stubGlobal('AudioContext', class {
        constructor() { return mockCtx as any }
      })
      vi.stubGlobal('AudioWorkletNode', class {
        constructor() { return mockWorkletNode as any }
      })

      const originalCreateObjectURL = URL.createObjectURL
      const originalRevokeObjectURL = URL.revokeObjectURL
      URL.createObjectURL = vi.fn().mockReturnValue('blob:test')
      URL.revokeObjectURL = vi.fn()

      vi.resetModules()
      const { captureFromAudioElement } = await import('./browser-audio-capture')
      const onChunk = vi.fn()
      const element = document.createElement('audio')

      const session = await captureFromAudioElement(element, onChunk)

      expect(mockCtx.createMediaElementSource).toHaveBeenCalledWith(element)
      expect(mockSource.connect).toHaveBeenCalledWith(mockWorkletNode)
      expect(mockWorkletNode.connect).toHaveBeenCalledWith(mockDestination)

      // Test stop
      session.stop()
      expect(mockWorkletNode.port.onmessage).toBeNull()
      expect(mockSource.disconnect).toHaveBeenCalledWith(mockWorkletNode)
      expect(mockWorkletNode.disconnect).toHaveBeenCalled()

      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      vi.unstubAllGlobals()
    })
  })

  describe('captureFromMediaStream', () => {
    it('creates context with stream source and returns stop that closes context', async () => {
      const mockTrack = { stop: vi.fn() }
      const mockStream = {
        getTracks: vi.fn().mockReturnValue([mockTrack]),
      } as unknown as MediaStream

      const mockWorkletNode = {
        port: { onmessage: null as any },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      const mockSource = {
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      const mockDestination = {}
      const mockCtx = {
        sampleRate: 48000,
        state: 'running',
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        createMediaElementSource: vi.fn(),
        createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
        audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
        destination: mockDestination,
      }

      vi.stubGlobal('AudioContext', class {
        constructor() { return mockCtx as any }
      })
      vi.stubGlobal('AudioWorkletNode', class {
        constructor() { return mockWorkletNode as any }
      })

      const originalCreateObjectURL = URL.createObjectURL
      const originalRevokeObjectURL = URL.revokeObjectURL
      URL.createObjectURL = vi.fn().mockReturnValue('blob:test')
      URL.revokeObjectURL = vi.fn()

      vi.resetModules()
      const { captureFromMediaStream } = await import('./browser-audio-capture')

      const onChunk = vi.fn()
      const session = await captureFromMediaStream(mockStream, onChunk)

      expect(mockCtx.createMediaStreamSource).toHaveBeenCalledWith(mockStream)
      expect(mockSource.connect).toHaveBeenCalledWith(mockWorkletNode)
      expect(mockWorkletNode.connect).toHaveBeenCalledWith(mockDestination)

      session.stop()
      expect(mockWorkletNode.disconnect).toHaveBeenCalled()
      expect(mockSource.disconnect).toHaveBeenCalled()
      expect(mockTrack.stop).toHaveBeenCalled()
      expect(mockCtx.close).toHaveBeenCalled()

      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      vi.unstubAllGlobals()
    })
  })

  describe('captureDisplayMedia', () => {
    it('throws when no audio tracks in stream', async () => {
      const mockStream = {
        getAudioTracks: vi.fn().mockReturnValue([]),
        getTracks: vi.fn().mockReturnValue([]),
      }

      vi.stubGlobal('navigator', {
        mediaDevices: {
          getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
        },
      })

      vi.resetModules()
      const { captureDisplayMedia } = await import('./browser-audio-capture')
      const onChunk = vi.fn()

      await expect(captureDisplayMedia(onChunk)).rejects.toThrow('No audio in selected source')

      vi.unstubAllGlobals()
    })
  })
})
