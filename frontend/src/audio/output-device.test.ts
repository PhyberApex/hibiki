import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchLocalOutputDevice } from '@/api/config'
import { listOutputDevices, OutputDeviceRouter, resolveOutputDevice } from './output-device'

vi.mock('@/api/config', () => ({
  fetchLocalOutputDevice: vi.fn(),
}))

const usb = { deviceId: 'usb', label: 'USB Speaker' }
const builtin = { deviceId: 'builtin', label: 'Built-in Output' }

describe('resolveOutputDevice', () => {
  it('uses the system default without a stored choice', () => {
    expect(resolveOutputDevice(null, [usb])).toEqual({ sinkId: '' })
  })
  it('uses the stored device when connected', () => {
    expect(resolveOutputDevice(usb, [builtin, usb])).toEqual({ sinkId: 'usb' })
  })
  it('falls back to the system default naming the missing device', () => {
    expect(resolveOutputDevice(usb, [builtin])).toEqual({ sinkId: '', missingLabel: 'USB Speaker' })
  })
})

describe('listOutputDevices', () => {
  it('keeps real audio outputs and numbers empty labels', () => {
    const all = [
      { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
      { kind: 'audiooutput', deviceId: 'default', label: 'Default' },
      { kind: 'audiooutput', deviceId: 'a', label: '' },
    ] as MediaDeviceInfo[]
    expect(listOutputDevices(all)).toEqual([
      { deviceId: 'a', label: 'Output device 1' },
    ])
  })
})

describe('outputDeviceRouter', () => {
  function setup() {
    const onMissing = vi.fn()
    const router = new OutputDeviceRouter({ onMissing })
    const changes: string[] = []
    router.subscribe(id => changes.push(id))
    return { router, onMissing, changes }
  }

  it('does not warn before the first device list exists', () => {
    const { router, onMissing } = setup()
    router.setChoice(usb)
    expect(onMissing).not.toHaveBeenCalled()
  })

  it('routes to the stored device and applies a change live', () => {
    const { router, changes } = setup()
    router.setDevices([usb, builtin])
    router.setChoice(usb)
    router.setChoice(null)
    expect(changes).toEqual(['usb', ''])
  })

  it('warns once per absence, keeps the choice, and returns without a toast', () => {
    const { router, onMissing, changes } = setup()
    router.setChoice(usb)
    router.setDevices([builtin])
    router.setDevices([builtin])
    router.setDevices([
      builtin,
      { deviceId: 'x', label: 'x' },
    ])
    expect(onMissing).toHaveBeenCalledTimes(1)
    expect(onMissing).toHaveBeenCalledWith('USB Speaker')
    router.setDevices([builtin, usb])
    expect(router.sinkId).toBe('usb')
    expect(onMissing).toHaveBeenCalledTimes(1)
    router.setDevices([builtin])
    expect(onMissing).toHaveBeenCalledTimes(2)
    expect(changes).toEqual(['usb', ''])
  })
})

describe('installOutputDevice', () => {
  const output = (deviceId: string, label: string) => ({ kind: 'audiooutput', deviceId, label }) as MediaDeviceInfo
  let devices: MediaDeviceInfo[]
  let onDeviceChange: (() => Promise<void>) | undefined
  const mediaDevices = {
    enumerateDevices: vi.fn(async () => devices),
    addEventListener: vi.fn((_type: string, listener: () => Promise<void>) => {
      onDeviceChange = listener
    }),
    removeEventListener: vi.fn(),
  }

  /** A fresh module so the shared router and bound elements start empty. */
  async function load() {
    vi.resetModules()
    return import('./output-device')
  }

  function audioElement(setSinkId = vi.fn(async (_id: string) => {})) {
    return Object.assign(document.createElement('audio'), { setSinkId })
  }

  beforeEach(() => {
    devices = [
      output('builtin', 'Built-in Output'),
    ]
    onDeviceChange = undefined
    vi.stubGlobal('navigator', { mediaDevices })
    vi.mocked(fetchLocalOutputDevice).mockResolvedValue(usb)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('is a no-op without mediaDevices', async () => {
    vi.stubGlobal('navigator', {})
    const { installOutputDevice } = await load()
    const notify = vi.fn()
    expect(() => installOutputDevice(notify)()).not.toThrow()
    expect(fetchLocalOutputDevice).not.toHaveBeenCalled()
  })

  it('warns exactly once when the stored device is absent and falls back to the system default', async () => {
    const { installOutputDevice, outputDeviceRouter } = await load()
    const notify = vi.fn()
    installOutputDevice(notify)
    await flushPromises()
    expect(notify).toHaveBeenCalledExactlyOnceWith('USB Speaker')
    expect(outputDeviceRouter.sinkId).toBe('')
    devices = [
      output('builtin', 'Built-in Output'),
      output('hdmi', 'HDMI'),
    ]
    await onDeviceChange?.()
    expect(notify).toHaveBeenCalledOnce()
    expect(outputDeviceRouter.sinkId).toBe('')
  })

  it('re-resolves on devicechange and routes bound audio elements to the device', async () => {
    const { bindAudioElement, installOutputDevice, outputDeviceRouter } = await load()
    const el = audioElement()
    bindAudioElement(el)
    expect(el.setSinkId).not.toHaveBeenCalled()
    installOutputDevice(vi.fn())
    await flushPromises()
    devices = [
      output('builtin', 'Built-in Output'),
      output('usb', 'USB Speaker'),
    ]
    await onDeviceChange?.()
    expect(outputDeviceRouter.sinkId).toBe('usb')
    expect(el.setSinkId).toHaveBeenCalledWith('usb')
    devices = [
      output('builtin', 'Built-in Output'),
    ]
    await onDeviceChange?.()
    expect(el.setSinkId).toHaveBeenLastCalledWith('')
  })

  it('routes an element bound after the device resolved straight away', async () => {
    devices = [
      output('usb', 'USB Speaker'),
    ]
    const { bindAudioElement, installOutputDevice } = await load()
    installOutputDevice(vi.fn())
    await flushPromises()
    const el = audioElement()
    bindAudioElement(el)
    expect(el.setSinkId).toHaveBeenCalledWith('usb')
  })

  it('logs a setSinkId rejection instead of throwing', async () => {
    devices = [
      output('usb', 'USB Speaker'),
    ]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { bindAudioElement, installOutputDevice } = await load()
    const el = audioElement(vi.fn(async () => {
      throw new Error('NotAllowedError')
    }))
    bindAudioElement(el)
    installOutputDevice(vi.fn())
    await flushPromises()
    expect(el.setSinkId).toHaveBeenCalledWith('usb')
    expect(warn).toHaveBeenCalledWith('[output-device] could not route an audio element:', expect.any(Error))
  })

  it('skips elements without setSinkId', async () => {
    devices = [
      output('usb', 'USB Speaker'),
    ]
    const { bindAudioElement, installOutputDevice } = await load()
    installOutputDevice(vi.fn())
    await flushPromises()
    expect(() => bindAudioElement(document.createElement('audio'))).not.toThrow()
  })

  it('falls back to the system default when the stored choice cannot be loaded', async () => {
    devices = [
      output('usb', 'USB Speaker'),
    ]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fetchLocalOutputDevice).mockRejectedValue(new Error('ipc down'))
    const { installOutputDevice, outputDeviceRouter } = await load()
    const notify = vi.fn()
    installOutputDevice(notify)
    await flushPromises()
    expect(warn).toHaveBeenCalledWith('[output-device] could not load the stored Output Device:', expect.any(Error))
    expect(outputDeviceRouter.sinkId).toBe('')
    expect(notify).not.toHaveBeenCalled()
  })

  it('logs a failed device enumeration', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mediaDevices.enumerateDevices.mockRejectedValueOnce(new Error('denied'))
    const { installOutputDevice } = await load()
    installOutputDevice(vi.fn())
    await flushPromises()
    expect(warn).toHaveBeenCalledWith('[output-device] could not list output devices:', expect.any(Error))
  })

  it('removes the devicechange listener on uninstall', async () => {
    const { installOutputDevice } = await load()
    const uninstall = installOutputDevice(vi.fn())
    uninstall()
    expect(mediaDevices.removeEventListener).toHaveBeenCalledWith('devicechange', onDeviceChange)
  })
})
