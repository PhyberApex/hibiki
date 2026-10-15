import { createOutputTargetSettings } from './output-target-settings'

function setup(token = false, initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const settings = createOutputTargetSettings(
    { get: async k => data.get(k) ?? null, set: async (k, v) => { data.set(k, v) } },
    async () => token,
  )
  return { data, settings }
}

describe('output target settings', () => {
  it('defaults to Local without a Discord token and Discord with one', async () => {
    expect(await setup(false).settings.getActive()).toBe('local')
    expect(await setup(true).settings.getActive()).toBe('discord')
  })

  it('persists the active target and lets it win over the default', async () => {
    const { settings } = setup(true)
    await settings.setActive('local')
    expect(await settings.getActive()).toBe('local')
  })

  it('rejects unknown targets and falls back on corrupt stored values', async () => {
    const { settings } = setup(false, { 'output.activeTarget': 'garbage' })
    await expect(settings.setActive('mars')).rejects.toThrow('Unknown output target')
    expect(await settings.getActive()).toBe('local')
  })

  it('keeps master volume per target, defaulting to 80', async () => {
    const { settings } = setup()
    await settings.setMasterVolume('local', 30)
    await settings.setMasterVolume('discord', 60)
    expect(await settings.getMasterVolume('local')).toBe(30)
    expect(await settings.getMasterVolume('discord')).toBe(60)
    expect(await setup().settings.getMasterVolume('local')).toBe(80)
  })

  it('migrates the legacy single master volume to the Discord target only', async () => {
    const { settings, data } = setup(true, { 'player.masterVolume': '42' })
    expect(await settings.getMasterVolume('local')).toBe(80)
    expect(await settings.getMasterVolume('discord')).toBe(42)
    expect(data.get('player.masterVolume.discord')).toBe('42')
  })
})
