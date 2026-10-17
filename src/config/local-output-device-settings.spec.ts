import { createLocalOutputDeviceSettings } from './local-output-device-settings'

function setup(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const settings = createLocalOutputDeviceSettings({
    get: async k => data.get(k) ?? null,
    set: async (k, v) => {
      data.set(k, v)
    },
  })
  return { data, settings }
}

describe('local output device settings', () => {
  it('defaults to System default (null) on a fresh install', async () => {
    expect(await setup().settings.get()).toBeNull()
  })

  it('round-trips { deviceId, label }', async () => {
    const { settings } = setup()
    await settings.set({ deviceId: 'abc', label: 'USB Speaker' })
    expect(await settings.get()).toEqual({ deviceId: 'abc', label: 'USB Speaker' })
  })

  it('clears back to System default', async () => {
    const { settings } = setup()
    await settings.set({ deviceId: 'abc', label: 'USB Speaker' })
    await settings.set(null)
    expect(await settings.get()).toBeNull()
  })

  it('falls back to default on malformed stored JSON or shape', async () => {
    expect(await setup({ 'output.local.device': '{nope' }).settings.get()).toBeNull()
    expect(await setup({ 'output.local.device': '{"deviceId":5}' }).settings.get()).toBeNull()
  })

  it('treats the "default" device id as System default', async () => {
    const { settings } = setup()
    await settings.set({ deviceId: 'default', label: 'Default' })
    expect(await settings.get()).toBeNull()
  })
})
