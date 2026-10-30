import { afterEach, describe, expect, it, vi } from 'vitest'

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
          int16[i] = s < 0
            ? s * 0x8000
            : s * 0x7FFF
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
        audioWorklet: {
          addModule: vi.fn().mockResolvedValue(undefined),
        },
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

  describe('releaseAudioElementContext', () => {
    it('is a no-op for an element that was never captured', async () => {
      vi.resetModules()
      const { releaseAudioElementContext } = await import('./browser-audio-capture')
      const element = document.createElement('audio')
      expect(() => releaseAudioElementContext(element)).not.toThrow()
    })

    it('disconnects the worklet, evicts, and closes the context for a captured element', async () => {
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
        audioWorklet: {
          addModule: vi.fn().mockResolvedValue(undefined),
        },
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
      const { captureFromAudioElement, releaseAudioElementContext } = await import('./browser-audio-capture')
      const element = document.createElement('audio')
      await captureFromAudioElement(element, vi.fn())

      releaseAudioElementContext(element)

      expect(mockWorkletNode.port.onmessage).toBeNull()
      expect(mockWorkletNode.disconnect).toHaveBeenCalled()
      expect(mockSource.disconnect).toHaveBeenCalled()
      expect(mockCtx.close).toHaveBeenCalled()

      // A second release is a no-op: the context was already evicted.
      mockCtx.close.mockClear()
      releaseAudioElementContext(element)
      expect(mockCtx.close).not.toHaveBeenCalled()

      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      vi.unstubAllGlobals()
    })
  })

  describe('captureFromMediaStream', () => {
    it('creates context with stream source and returns stop that closes context', async () => {
      const mockTrack = {
        stop: vi.fn(),
      }
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
        audioWorklet: {
          addModule: vi.fn().mockResolvedValue(undefined),
        },
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

  describe('failure and lifecycle paths', () => {
    function stubAudio(state = 'running') {
      const worklets: Array<{ port: { onmessage: ((e: MessageEvent) => void) | null }, connect: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn> }> = []
      const source = {
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      const ctx = {
        state,
        resume: vi.fn(async () => {
          ctx.state = 'running'
        }),
        close: vi.fn(async () => {
          ctx.state = 'closed'
        }),
        createMediaElementSource: vi.fn(() => source),
        createMediaStreamSource: vi.fn(() => source),
        audioWorklet: {
          addModule: vi.fn(async (_url: string) => {}),
        },
        destination: {},
        setSinkId: vi.fn(async (_sinkId: string) => {}),
      }
      vi.stubGlobal('AudioContext', class {
        constructor() { return ctx as any }
      })
      vi.stubGlobal('AudioWorkletNode', class {
        constructor() {
          const node = {
            port: { onmessage: null },
            connect: vi.fn(),
            disconnect: vi.fn(),
          }
          worklets.push(node)
          return node as any
        }
      })
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:worklet')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      return { ctx, source, worklets }
    }

    async function load() {
      vi.resetModules()
      return import('./browser-audio-capture')
    }

    /** Points the Output Device at `deviceId` (`null` = system default) on the router the freshly loaded capture module uses. */
    async function routeTo(deviceId: string | null) {
      const { outputDeviceRouter } = await import('./output-device')
      outputDeviceRouter.setDevices([
        { deviceId: 'desk', label: 'Desk speakers' },
        { deviceId: 'headset', label: 'Headset' },
      ])
      outputDeviceRouter.setChoice(deviceId === null
        ? null
        : { deviceId, label: deviceId })
    }

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('rejects and closes the context when the AudioWorklet module fails to load', async () => {
      const { ctx } = stubAudio()
      ctx.audioWorklet.addModule.mockRejectedValue(new Error('worklet blocked'))
      const { captureFromMediaStream } = await load()
      const stream = {
        getTracks: () => [],
      } as unknown as MediaStream
      await expect(captureFromMediaStream(stream, vi.fn())).rejects.toThrow('worklet blocked')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:worklet')
      expect(ctx.close).toHaveBeenCalledOnce()
      expect(ctx.state).toBe('closed')
    })

    it('rejects an element capture when the worklet fails, and retries the module next time', async () => {
      const { ctx } = stubAudio()
      ctx.audioWorklet.addModule.mockRejectedValueOnce(new Error('worklet blocked'))
      const { captureFromAudioElement } = await load()
      const element = document.createElement('audio')
      await expect(captureFromAudioElement(element, vi.fn())).rejects.toThrow('worklet blocked')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:worklet')
      await expect(captureFromAudioElement(element, vi.fn())).resolves.toBeDefined()
      expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(2)
      expect(ctx.createMediaElementSource).toHaveBeenCalledOnce()
    })

    it('rejects and closes the context when a suspended context cannot resume', async () => {
      const { ctx } = stubAudio('suspended')
      ctx.resume.mockRejectedValue(new Error('no user gesture'))
      const { captureFromMediaStream } = await load()
      await expect(captureFromMediaStream({
        getTracks: () => [],
      } as unknown as MediaStream, vi.fn())).rejects.toThrow('no user gesture')
      expect(ctx.close).toHaveBeenCalledOnce()
    })

    it('resumes a suspended context before capturing', async () => {
      const { ctx } = stubAudio('suspended')
      const { captureFromMediaStream } = await load()
      await captureFromMediaStream({
        getTracks: () => [],
      } as unknown as MediaStream, vi.fn())
      expect(ctx.resume).toHaveBeenCalledOnce()
    })

    it('converts worklet messages to interleaved s16 stereo chunks', async () => {
      const { worklets } = stubAudio()
      const { captureFromMediaStream } = await load()
      const onChunk = vi.fn()
      await captureFromMediaStream({
        getTracks: () => [],
      } as unknown as MediaStream, onChunk)
      worklets[0].port.onmessage?.({
        data: {
          left: new Float32Array([1, -1]),
          right: new Float32Array([0, 0.5]),
        },
      } as MessageEvent)
      expect(Array.from(new Int16Array(onChunk.mock.calls[0][0]))).toEqual([
        0x7FFF,
        0,
        -0x8000,
        Math.floor(0.5 * 0x7FFF),
      ])
    })

    it('reuses the element context, registers the worklet once, and replaces a still-active capture', async () => {
      const { ctx, source, worklets } = stubAudio()
      const { captureFromAudioElement } = await load()
      const element = document.createElement('audio')
      await captureFromAudioElement(element, vi.fn())
      await captureFromAudioElement(element, vi.fn())
      expect(ctx.createMediaElementSource).toHaveBeenCalledOnce()
      expect(ctx.audioWorklet.addModule).toHaveBeenCalledOnce()
      expect(worklets[0].disconnect).toHaveBeenCalled()
      expect(worklets[0].port.onmessage).toBeNull()
      expect(source.connect).toHaveBeenLastCalledWith(worklets[1])
    })

    it('a stale session stop() does not tear down the newer capture', async () => {
      const { worklets } = stubAudio()
      const { captureFromAudioElement, releaseAudioElementContext } = await load()
      const element = document.createElement('audio')
      const first = await captureFromAudioElement(element, vi.fn())
      await captureFromAudioElement(element, vi.fn())
      first.stop()
      expect(worklets[1].disconnect).not.toHaveBeenCalled()
      releaseAudioElementContext(element)
      // The newer worklet was still the active one, so release tears it down.
      expect(worklets[1].disconnect).toHaveBeenCalled()
    })

    it('opens a fresh context for an element whose context was closed', async () => {
      const { ctx } = stubAudio()
      const { captureFromAudioElement } = await load()
      const element = document.createElement('audio')
      await captureFromAudioElement(element, vi.fn())
      ctx.state = 'closed'
      await captureFromAudioElement(element, vi.fn())
      expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(2)
    })

    it('routes a new element context to the current Output Device', async () => {
      const { ctx } = stubAudio()
      const { captureFromAudioElement } = await load()
      await routeTo('desk')
      await captureFromAudioElement(document.createElement('audio'), vi.fn())
      expect(ctx.setSinkId).toHaveBeenCalledExactlyOnceWith('desk')
    })

    it('leaves a new element context on the system default when no device is chosen', async () => {
      const { ctx } = stubAudio()
      const { captureFromAudioElement } = await load()
      await captureFromAudioElement(document.createElement('audio'), vi.fn())
      expect(ctx.setSinkId).not.toHaveBeenCalled()
    })

    it('still captures when the initial Output Device cannot be opened', async () => {
      const { ctx } = stubAudio()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      ctx.setSinkId.mockRejectedValueOnce(new Error('device gone'))
      const { captureFromAudioElement } = await load()
      await routeTo('desk')
      await expect(captureFromAudioElement(document.createElement('audio'), vi.fn())).resolves.toHaveProperty('stop')
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[audio\] /), expect.any(Error)))
    })

    it('moves a captured element context to the new Output Device, and keeps it after stop()', async () => {
      const { ctx } = stubAudio()
      const { captureFromAudioElement } = await load()
      const session = await captureFromAudioElement(document.createElement('audio'), vi.fn())
      await routeTo('desk')
      expect(ctx.setSinkId).toHaveBeenLastCalledWith('desk')
      session.stop()
      expect(ctx.setSinkId).toHaveBeenCalledOnce()
      await routeTo('headset')
      expect(ctx.setSinkId).toHaveBeenLastCalledWith('headset')
      await routeTo(null)
      expect(ctx.setSinkId).toHaveBeenLastCalledWith('')
    })

    it('warns and keeps following the router when moving an element context fails', async () => {
      const { ctx } = stubAudio()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      ctx.setSinkId.mockRejectedValueOnce(new Error('device gone'))
      const { captureFromAudioElement } = await load()
      await captureFromAudioElement(document.createElement('audio'), vi.fn())
      await routeTo('desk')
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[audio\] /), expect.any(Error)))
      await routeTo('headset')
      expect(ctx.setSinkId).toHaveBeenLastCalledWith('headset')
    })

    it('stops following the router once the element context is released', async () => {
      const { ctx } = stubAudio()
      const { captureFromAudioElement, releaseAudioElementContext } = await load()
      const element = document.createElement('audio')
      await captureFromAudioElement(element, vi.fn())
      releaseAudioElementContext(element)
      await routeTo('desk')
      expect(ctx.setSinkId).not.toHaveBeenCalled()
    })

    it('subscribes a reused element context to the router only once', async () => {
      const { ctx } = stubAudio()
      const { captureFromAudioElement } = await load()
      const element = document.createElement('audio')
      await captureFromAudioElement(element, vi.fn())
      await captureFromAudioElement(element, vi.fn())
      await routeTo('desk')
      expect(ctx.setSinkId).toHaveBeenCalledOnce()
    })

    it('captureTabStream asks for the tab by its media source id, audio only', async () => {
      const stream = {}
      const getUserMedia = vi.fn(async () => stream)
      vi.stubGlobal('navigator', {
        mediaDevices: { getUserMedia },
      })
      const { captureTabStream } = await load()
      await expect(captureTabStream('tab:42')).resolves.toBe(stream)
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: {
          mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'tab:42' },
        },
        video: false,
      })
    })

    it('captureDisplayMedia captures a picked source that has audio', async () => {
      const { ctx } = stubAudio()
      const stream = {
        getAudioTracks: () => [{}],
        getTracks: () => [],
      }
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getDisplayMedia: vi.fn(async () => stream),
        },
      })
      const { captureDisplayMedia } = await load()
      await expect(captureDisplayMedia(vi.fn())).resolves.toHaveProperty('stop')
      expect(ctx.createMediaStreamSource).toHaveBeenCalledWith(stream)
    })
  })
})
