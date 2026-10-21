import { createUsageStatsSettings } from './usage-stats-settings'

function setup(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const settings = createUsageStatsSettings({
    get: async k => data.get(k) ?? null,
    set: async (k, v) => {
      data.set(k, v)
    },
  })
  return { data, settings }
}

describe('usage stats settings', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => jest.restoreAllMocks())

  it('defaults to off and not yet prompted', async () => {
    expect(await setup().settings.get()).toEqual({ enabled: false, prompted: false })
  })

  it('falls back to off on corrupt or non-boolean stored values', async () => {
    expect(await setup({ usageStats: 'garbage' }).settings.get()).toEqual({ enabled: false, prompted: false })
    expect(await setup({ usageStats: '{"enabled":"yes","prompted":1}' }).settings.get()).toEqual({ enabled: false, prompted: false })
    expect(await setup({ usageStats: 'null' }).settings.get()).toEqual({ enabled: false, prompted: false })
  })

  it('persists the toggle without touching prompted', async () => {
    const { settings, data } = setup()
    expect(await settings.setEnabled(true)).toEqual({ enabled: true, prompted: false })
    expect(JSON.parse(data.get('usageStats')!)).toEqual({ enabled: true, prompted: false })
    await settings.setEnabled(false)
    expect(await settings.get()).toEqual({ enabled: false, prompted: false })
  })

  it('marks the invitation answered without enabling', async () => {
    const { settings } = setup()
    expect(await settings.markPrompted()).toEqual({ enabled: false, prompted: true })
    await settings.setEnabled(true)
    expect(await settings.get()).toEqual({ enabled: true, prompted: true })
  })

  it('rejects a non-boolean toggle', async () => {
    const { settings, data } = setup()
    await expect(settings.setEnabled('yes' as never)).rejects.toThrow(TypeError)
    expect(data.size).toBe(0)
  })

  it('logs transitions at info', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {})
    await setup().settings.setEnabled(true)
    expect(info).toHaveBeenCalledWith('[config]', 'Usage Stats enabled')
  })
})
