import {
  buildJoinMenuPayload,
  buildPanelComponents,
  buildPlayMenuPayload,
  formatListText,
} from './discord-panel.builder'

describe('discord-panel.builder', () => {
  describe('buildPanelComponents', () => {
    it('returns content and 5 component rows', () => {
      const { content, components } = buildPanelComponents()
      expect(content).toContain('control panel')
      expect(components).toHaveLength(5)
    })

    it('row1 has join, leave, stop buttons with correct customIds', () => {
      const { components } = buildPanelComponents()
      const row1 = components[0] as { components: { toJSON: () => { custom_id?: string } }[] }
      const ids = row1.components.map((c: { toJSON: () => { custom_id?: string } }) => c.toJSON().custom_id)
      expect(ids).toContain('hibiki_btn_join')
      expect(ids).toContain('hibiki_btn_leave')
      expect(ids).toContain('hibiki_btn_stop')
    })

    it('row2 has play music, play effect, songs, effects buttons', () => {
      const { components } = buildPanelComponents()
      const row2 = components[1] as { components: { toJSON: () => { custom_id?: string } }[] }
      const ids = row2.components.map((c: { toJSON: () => { custom_id?: string } }) => c.toJSON().custom_id)
      expect(ids).toContain('hibiki_btn_play_music')
      expect(ids).toContain('hibiki_btn_play_effect')
      expect(ids).toContain('hibiki_btn_songs')
      expect(ids).toContain('hibiki_btn_effects')
    })

    it('row3 has main select menu with join, leave, stop, play_music, play_effect, songs, effects', () => {
      const { components } = buildPanelComponents()
      const row3 = components[2] as { components: { toJSON: () => { custom_id?: string, options?: { value: string }[] } }[] }
      const menuJson = row3.components[0].toJSON()
      expect(menuJson.custom_id).toBe('hibiki_menu_main')
      const values = (menuJson.options ?? []).map((o: { value: string }) => o.value)
      expect(values).toContain('join')
      expect(values).toContain('leave')
      expect(values).toContain('stop')
      expect(values).toContain('play_music')
      expect(values).toContain('play_effect')
      expect(values).toContain('songs')
      expect(values).toContain('effects')
    })

    it('row4 and row5 are volume menus', () => {
      const { components } = buildPanelComponents()
      const row4 = components[3] as { components: { toJSON: () => { custom_id?: string } }[] }
      const row5 = components[4] as { components: { toJSON: () => { custom_id?: string } }[] }
      expect(row4.components[0].toJSON().custom_id).toBe('hibiki_menu_volume_music')
      expect(row5.components[0].toJSON().custom_id).toBe('hibiki_menu_volume_effects')
    })
  })

  describe('buildJoinMenuPayload', () => {
    it('returns empty message and no components when directory is empty', () => {
      const result = buildJoinMenuPayload([], 25)
      expect(result.content).toBe('No voice channels available.')
      expect(result.components).toHaveLength(0)
      expect(result.ephemeral).toBe(true)
    })

    it('returns prompt and one menu when directory has channels', () => {
      const directory = [
        {
          guildId: 'g1',
          guildName: 'Server 1',
          channels: [{ id: 'c1', name: 'General' }, { id: 'c2', name: 'Music' }],
        },
      ]
      const result = buildJoinMenuPayload(directory, 25)
      expect(result.content).toContain('Join')
      expect(result.components).toHaveLength(1)
      const row = result.components[0] as { components: { toJSON: () => { options?: { value: string, label: string }[] } }[] }
      const menuJson = row.components[0].toJSON()
      expect(menuJson.options).toHaveLength(2)
      expect(menuJson.options![0].value).toBe('g1_c1')
      expect(menuJson.options![0].label).toContain('Server 1')
      expect(menuJson.options![0].label).toContain('General')
    })

    it('respects maxOptions and slices to 5 channels per guild', () => {
      const directory = [
        {
          guildId: 'g1',
          guildName: 'G',
          channels: [
            { id: '1', name: 'A' },
            { id: '2', name: 'B' },
            { id: '3', name: 'C' },
            { id: '4', name: 'D' },
            { id: '5', name: 'E' },
            { id: '6', name: 'F' },
          ],
        },
      ]
      const result = buildJoinMenuPayload(directory, 25)
      const row = result.components[0] as { components: { toJSON: () => { options: unknown[] } }[] }
      expect(row.components[0].toJSON().options).toHaveLength(5)
    })

    it('stops at maxOptions across guilds', () => {
      const directory = [
        { guildId: 'g1', guildName: 'G1', channels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
        { guildId: 'g2', guildName: 'G2', channels: [{ id: 'c', name: 'C' }] },
      ]
      const result = buildJoinMenuPayload(directory, 2)
      const row = result.components[0] as { components: { toJSON: () => { options: unknown[] } }[] }
      expect(row.components[0].toJSON().options).toHaveLength(2)
    })
  })

  describe('buildPlayMenuPayload', () => {
    it('returns empty music message and no components when list is empty', () => {
      const result = buildPlayMenuPayload([], 'music', 25)
      expect(result.content).toContain('No songs uploaded')
      expect(result.components).toHaveLength(0)
      expect(result.ephemeral).toBe(true)
    })

    it('returns empty effects message when list is empty for effects', () => {
      const result = buildPlayMenuPayload([], 'effects', 25)
      expect(result.content).toContain('No effects uploaded')
      expect(result.components).toHaveLength(0)
    })

    it('returns music prompt and menu with tracks', () => {
      const list = [{ id: 'id1', name: 'Track One' }, { id: 'id2', name: 'Track Two' }]
      const result = buildPlayMenuPayload(list, 'music', 25)
      expect(result.content).toContain('Play music')
      expect(result.components).toHaveLength(1)
      const row = result.components[0] as { components: { toJSON: () => { custom_id: string, options: { value: string, label: string }[] } }[] }
      const menuJson = row.components[0].toJSON()
      expect(menuJson.custom_id).toBe('hibiki_menu_play_music')
      expect(menuJson.options).toHaveLength(2)
      expect(menuJson.options[0].value).toBe('id1')
      expect(menuJson.options[0].label).toBe('Track One')
    })

    it('returns effects prompt and menu with effects', () => {
      const list = [{ id: 'e1', name: 'Boom' }]
      const result = buildPlayMenuPayload(list, 'effects', 25)
      expect(result.content).toContain('Play effect')
      const row = result.components[0] as { components: { toJSON: () => { custom_id: string } }[] }
      expect(row.components[0].toJSON().custom_id).toBe('hibiki_menu_play_effect')
    })

    it('truncates long names with ellipsis', () => {
      const longName = 'A'.repeat(110)
      const result = buildPlayMenuPayload([{ id: 'x', name: longName }], 'music', 25)
      const row = result.components[0] as { components: { toJSON: () => { options: { label: string }[] } }[] }
      const label = row.components[0].toJSON().options[0].label
      expect(label.length).toBeLessThanOrEqual(100)
      expect(label.endsWith('…')).toBe(true)
    })

    it('respects maxOptions slice', () => {
      const list = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}`, name: `Track ${i}` }))
      const result = buildPlayMenuPayload(list, 'music', 10)
      const row = result.components[0] as { components: { toJSON: () => { options: unknown[] } }[] }
      expect(row.components[0].toJSON().options).toHaveLength(10)
    })
  })

  describe('formatListText', () => {
    it('formats list without ids by default', () => {
      const list = [{ name: 'First' }, { name: 'Second' }]
      expect(formatListText(list, 10)).toBe('1. **First**\n2. **Second**')
    })

    it('formats list with ids when showIds is true', () => {
      const list = [{ id: 'a1', name: 'First' }, { id: 'b2', name: 'Second' }]
      expect(formatListText(list, 10, true)).toBe(
        '1. **First** (`a1`)\n2. **Second** (`b2`)',
      )
    })

    it('appends "and N more" when list exceeds maxItems', () => {
      const list = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]
      expect(formatListText(list, 2)).toBe(
        '1. **A**\n2. **B**\n… and 2 more.',
      )
    })

    it('does not append more when list length equals maxItems', () => {
      const list = [{ name: 'A' }, { name: 'B' }]
      expect(formatListText(list, 2)).toBe('1. **A**\n2. **B**')
    })

    it('omits id when showIds is true but item has no id', () => {
      const list = [{ name: 'NoId' }]
      expect(formatListText(list, 10, true)).toBe('1. **NoId**')
    })
  })
})
