import { createDiscordTokenSettings, isDiscordTokenConfigured } from './discord-token-settings'
import { createOutputTargetSettings } from './output-target-settings'

function setup(initial: Record<string, string> = {}, envToken = '') {
  const data = new Map(Object.entries(initial))
  const store = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => { data.set(k, v) },
    delete: async (k: string) => { data.delete(k) },
  }
  const discord = { destroy: jest.fn(async () => {}) }
  const player = { disconnectAllVoice: jest.fn(async () => {}) }
  const outputTargets = createOutputTargetSettings(store, () => isDiscordTokenConfigured(store, envToken))
  const settings = createDiscordTokenSettings({ store, envToken, encrypted: true, outputTargets, discord, player })
  return { data, settings, discord, player, outputTargets }
}

describe('discord token settings', () => {
  it('reports whether a token is configured, from the store or the environment', async () => {
    expect(await setup().settings.getStatus()).toEqual({ tokenConfigured: false, encrypted: true })
    expect((await setup({ 'discord.token': 'abc' }).settings.getStatus()).tokenConfigured).toBe(true)
    expect((await setup({}, 'env-token').settings.getStatus()).tokenConfigured).toBe(true)
  })

  it('stores a trimmed token', async () => {
    const { settings, data } = setup()
    expect(await settings.setToken('  abc  ')).toMatchObject({ tokenConfigured: true })
    expect(data.get('discord.token')).toBe('abc')
  })

  it('ignores an empty or blank token, so a blank field never removes one', async () => {
    const { settings, data, discord, player } = setup({ 'discord.token': 'abc' })
    expect(await settings.setToken('')).toMatchObject({ tokenConfigured: true })
    expect(await settings.setToken('   ')).toMatchObject({ tokenConfigured: true })
    expect(data.get('discord.token')).toBe('abc')
    expect(discord.destroy).not.toHaveBeenCalled()
    expect(player.disconnectAllVoice).not.toHaveBeenCalled()
  })

  describe('clearToken', () => {
    it('removes the key, ends voice and disconnects the bot', async () => {
      const { settings, data, discord, player } = setup({ 'discord.token': 'abc' })
      expect(await settings.clearToken()).toEqual({ tokenConfigured: false, encrypted: true })
      expect(data.has('discord.token')).toBe(false)
      expect(player.disconnectAllVoice).toHaveBeenCalledTimes(1)
      expect(discord.destroy).toHaveBeenCalledTimes(1)
      expect(player.disconnectAllVoice.mock.invocationCallOrder[0]).toBeLessThan(discord.destroy.mock.invocationCallOrder[0])
    })

    it('makes Local the active Target when Discord was active', async () => {
      const { settings, outputTargets } = setup({ 'discord.token': 'abc', 'output.activeTarget': '"discord"' })
      await settings.clearToken()
      expect(await outputTargets.getActive()).toBe('local')
    })

    it('makes Local active when Discord was only active by default (no stored choice)', async () => {
      const { settings, outputTargets, data } = setup({ 'discord.token': 'abc' })
      expect(await outputTargets.getActive()).toBe('discord')
      await settings.clearToken()
      expect(await outputTargets.getActive()).toBe('local')
      expect(data.get('output.activeTarget')).toBe('"local"')
    })

    it('leaves Local active when it already was', async () => {
      const { settings, outputTargets } = setup({ 'discord.token': 'abc', 'output.activeTarget': '"local"' })
      await settings.clearToken()
      expect(await outputTargets.getActive()).toBe('local')
    })

    it('keeps the Discord master volume for the next token', async () => {
      const { settings, outputTargets, data } = setup({ 'discord.token': 'abc', 'player.masterVolume.discord': '65' })
      await settings.clearToken()
      expect(data.get('player.masterVolume.discord')).toBe('65')
      expect(await outputTargets.getMasterVolume('discord')).toBe(65)
    })

    it('still removes the stored token when ending voice fails', async () => {
      const { settings, data, discord, player } = setup({ 'discord.token': 'abc' })
      player.disconnectAllVoice.mockRejectedValueOnce(new Error('boom'))
      await settings.clearToken()
      expect(data.has('discord.token')).toBe(false)
      expect(discord.destroy).toHaveBeenCalledTimes(1)
    })
  })
})
