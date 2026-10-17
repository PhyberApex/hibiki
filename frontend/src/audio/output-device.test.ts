import { describe, expect, it, vi } from 'vitest'
import { listOutputDevices, OutputDeviceRouter, resolveOutputDevice } from './output-device'

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
    expect(listOutputDevices(all)).toEqual([{ deviceId: 'a', label: 'Output device 1' }])
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
    router.setDevices([builtin, { deviceId: 'x', label: 'x' }])
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
