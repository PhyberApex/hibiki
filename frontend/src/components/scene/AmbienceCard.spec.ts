import type { SceneItem } from '@/api/scenes'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import AmbienceCard from './AmbienceCard.vue'

const sounds = [
  {
    id: 'amb-1',
    name: 'Rain',
    filename: 'rain.mp3',
    category: 'ambience',
  },
  {
    id: 'amb-2',
    name: 'Wind',
    filename: 'wind.mp3',
    category: 'ambience',
  },
]

function mountCard(items: SceneItem[]) {
  return mount(AmbienceCard, {
    props: { items, sounds },
    global: {
      plugins: [
        createPinia(),
      ],
    },
  })
}

describe('ambienceCard', () => {
  it('offers only library sounds not yet in the Scene and emits the chosen one', async () => {
    const wrapper = mountCard([
      { soundId: 'amb-1', soundName: 'Rain' },
    ])
    const add = wrapper.get('select[aria-label="Add ambience"]')
    expect(add.findAll('option').map(o => o.text())).toEqual(['Add ambience…', 'Wind'])

    await add.setValue('amb-2')

    expect(wrapper.emitted('add')).toEqual([
      [sounds[1]],
    ])
    expect((add.element as HTMLSelectElement).value).toBe('')
  })

  it('raises the longest repeat interval to a new shortest one and asks for a save', async () => {
    const item: SceneItem = {
      soundId: 'amb-1',
      soundName: 'Rain',
      repeatMin: 5,
      repeatMax: 10,
    }
    const wrapper = mountCard([item])

    await wrapper.get('select[aria-label="Shortest repeat interval for Rain"]').setValue('30')

    expect(item).toMatchObject({ repeatMin: 30, repeatMax: 30 })
    expect(wrapper.emitted('persist')).toEqual([
      ['the repeat interval of Rain'],
    ])
  })

  it('flags a sound missing from the library and offers to resolve it', async () => {
    const item: SceneItem = { soundId: 'gone', soundName: 'Old rain' }
    const wrapper = mountCard([item])

    expect(wrapper.text()).toContain('missing')
    expect(wrapper.get('input[aria-label="Enable Old rain"]').attributes('disabled')).toBeDefined()
    await wrapper.get('.btn-resolve').trigger('click')

    expect(wrapper.emitted('resolve')).toEqual([
      [item],
    ])
  })
})
