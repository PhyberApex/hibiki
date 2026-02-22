import { getSlashCommandsJSON, slashCommands } from './discord-slash.commands'

describe('discord-slash.commands', () => {
  describe('getSlashCommandsJSON', () => {
    it('returns array of JSON for each slash command', () => {
      const json = getSlashCommandsJSON()
      expect(Array.isArray(json)).toBe(true)
      expect(json).toHaveLength(slashCommands.length)
      for (const cmd of json as { name: string, description: string }[]) {
        expect(cmd).toHaveProperty('name')
        expect(cmd).toHaveProperty('description')
        expect(typeof cmd.name).toBe('string')
        expect(typeof cmd.description).toBe('string')
      }
    })

    it('includes help, version, menu, panel, join, leave, stop, volume, songs, effects, play, effect, delete', () => {
      const json = getSlashCommandsJSON() as { name: string }[]
      const names = json.map(c => c.name)
      expect(names).toContain('help')
      expect(names).toContain('version')
      expect(names).toContain('menu')
      expect(names).toContain('panel')
      expect(names).toContain('join')
      expect(names).toContain('leave')
      expect(names).toContain('stop')
      expect(names).toContain('volume')
      expect(names).toContain('songs')
      expect(names).toContain('effects')
      expect(names).toContain('play')
      expect(names).toContain('effect')
      expect(names).toContain('delete')
    })
  })
})
