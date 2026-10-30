import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePlayerStore } from '@/stores/player'
import EffectsCard from './EffectsCard.vue'

const sounds = [
  {
    id: 'fx-1',
    name: 'Thunder',
    filename: 'thunder.mp3',
    category: 'effects',
  },
]

function mountCard() {
  return mount(EffectsCard, {
    props: {
      items: [
        { soundId: 'fx-1', soundName: 'Thunder' },
      ],
      sounds,
      hotkeyErrors: {},
    },
    global: {
      stubs: { HotkeyRecorder: true },
    },
  })
}

describe('effectsCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('disables the Effect trigger until a voice channel is joined on the Discord Target (#713)', async () => {
    const player = usePlayerStore()
    player.activeTarget = 'discord'
    player.guildId = 'g1'
    const wrapper = mountCard()
    const trigger = wrapper.get('button.effect-trigger')
    expect(trigger.attributes('disabled')).toBeDefined()
    expect(trigger.attributes('title')).toBe('Join a voice channel first')

    player.playerState = [
      { guildId: 'g1', connectedChannelId: 'c1' },
    ] as never
    await wrapper.vm.$nextTick()

    expect(trigger.attributes('disabled')).toBeUndefined()
    expect(trigger.attributes('title')).toBe('Play Thunder')
  })

  it('keeps the Effect trigger enabled under the Local Target', () => {
    usePlayerStore().activeTarget = 'local'
    const trigger = mountCard().get('button.effect-trigger')
    expect(trigger.attributes('disabled')).toBeUndefined()
  })
})
