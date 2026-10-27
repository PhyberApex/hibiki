import type { Scene } from '../scenes/scene-store'
import { computeAccelerators, createHotkeyRegistrar } from './hotkey-registrar'

function scene(id: string, hotkey: string | undefined, effects: { soundId: string, hotkey?: string }[] = []): Scene {
  return {
    id,
    name: id,
    hotkey,
    ambience: [],
    music: [],
    effects,
    createdAt: '',
    updatedAt: '',
  }
}

function fakeDriver(refuse: string[] = [], throwFor: string[] = []) {
  const held = new Map<string, () => void>()
  return {
    held,
    register: jest.fn((accelerator: string, cb: () => void) => {
      if (throwFor.includes(accelerator))
        throw new Error('no global shortcuts')
      if (refuse.includes(accelerator))
        return false
      held.set(accelerator, cb)
      return true
    }),
    unregister: jest.fn((accelerator: string) => { held.delete(accelerator) }),
  }
}

describe('computeAccelerators', () => {
  it('collects Scene, Effect and Stop hotkeys, sharing an accelerator reused across Scenes', () => {
    const scenes = [
      scene('a', 'F13', [
        { soundId: 'x', hotkey: 'F14' },
      ]),
      scene('b', undefined, [
        { soundId: 'y', hotkey: 'F14' },
      ]),
    ]
    const wanted = computeAccelerators(scenes, { enabled: true, stopHotkey: 'F16' })
    expect([
      ...wanted.keys(),
    ].sort()).toEqual(['F13', 'F14', 'F16'])
    expect(wanted.get('F14')).toHaveLength(2)
    expect(wanted.get('F16')).toEqual(['Stop Hotkey'])
  })
})

describe('hotkey registrar', () => {
  const wanted = (...keys: string[]) => new Map(keys.map(k => [
    k,
    [`owner ${k}`],
  ]))

  it('registers added keys, releases removed ones and leaves unchanged ones alone', () => {
    const driver = fakeDriver()
    const registrar = createHotkeyRegistrar(driver, noop)
    registrar.sync(wanted('F13', 'F14'), true)
    registrar.sync(wanted('F14', 'F15'), true)
    expect(driver.register.mock.calls.map(c => c[0])).toEqual(['F13', 'F14', 'F15'])
    expect(driver.unregister.mock.calls.map(c => c[0])).toEqual(['F13'])
    expect(registrar.getStatus().registered.sort()).toEqual(['F14', 'F15'])
  })

  it('releases everything when disabled and registers again when re-enabled', () => {
    const driver = fakeDriver()
    const registrar = createHotkeyRegistrar(driver, noop)
    registrar.sync(wanted('F13', 'F14'), true)
    registrar.sync(wanted('F13', 'F14'), false)
    expect(driver.held.size).toBe(0)
    expect(registrar.getStatus().enabled).toBe(false)
    registrar.sync(wanted('F13', 'F14'), true)
    expect([
      ...driver.held.keys(),
    ].sort()).toEqual(['F13', 'F14'])
  })

  it('forwards a fire with its accelerator', () => {
    const driver = fakeDriver()
    const fired: string[] = []
    const registrar = createHotkeyRegistrar(driver, a => fired.push(a))
    registrar.sync(wanted('F13'), true)
    driver.held.get('F13')!()
    expect(fired).toEqual(['F13'])
  })

  it('collects refusals and throws as failures, and retries them on the next sync', () => {
    const driver = fakeDriver(['F13'], ['F14'])
    const registrar = createHotkeyRegistrar(driver, noop)
    registrar.sync(wanted('F13', 'F14', 'F15'), true)
    const { failures, registered } = registrar.getStatus()
    expect(registered).toEqual(['F15'])
    expect(failures.map(f => f.accelerator)).toEqual(['F13', 'F14'])
    expect(failures[0].owner).toBe('owner F13')
    expect(failures[1].reason).toBe('no global shortcuts')
    registrar.sync(wanted('F13', 'F15'), true)
    expect(driver.register.mock.calls.filter(c => c[0] === 'F13')).toHaveLength(2)
    expect(registrar.getStatus().failures.map(f => f.accelerator)).toEqual(['F13'])
  })

  it('releaseAll unregisters every key', () => {
    const driver = fakeDriver()
    const registrar = createHotkeyRegistrar(driver, noop)
    registrar.sync(wanted('F13', 'F14'), true)
    registrar.releaseAll()
    expect(driver.held.size).toBe(0)
  })
})

function noop() {}
