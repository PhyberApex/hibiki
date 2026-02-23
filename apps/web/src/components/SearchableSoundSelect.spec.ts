import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SearchableSoundSelect from './SearchableSoundSelect.vue'

const options = [
  { id: 'a1', name: 'Alpha' },
  { id: 'b2', name: 'Beta' },
  { id: 'c3', name: 'Gamma' },
]

describe('searchableSoundSelect', () => {
  it('renders with placeholder when no value', () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    expect(wrapper.find('.searchable-select-input').attributes('placeholder')).toBe('Select…')
    expect((wrapper.find('.searchable-select-input').element as HTMLInputElement).value).toBe('')
  })

  it('shows selected option name when modelValue is set', () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: 'b2' },
    })
    expect((wrapper.find('.searchable-select-input').element as HTMLInputElement).value).toBe('Beta')
  })

  it('opens dropdown on focus and shows options', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('focus')
    await flushPromises()
    expect(wrapper.find('.searchable-select-list').exists()).toBe(true)
    const opts = wrapper.findAll('.searchable-select-option')
    expect(opts).toHaveLength(3)
    expect(opts.map(o => o.text())).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('does not open when disabled', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '', disabled: true },
    })
    await wrapper.find('.searchable-select-input').trigger('focus')
    await flushPromises()
    expect(wrapper.find('.searchable-select-list').isVisible()).toBe(false)
  })

  it('filters options by typing', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('focus')
    await wrapper.find('.searchable-select-input').setValue('be')
    await flushPromises()
    const opts = wrapper.findAll('.searchable-select-option')
    expect(opts).toHaveLength(1)
    expect(opts.map(o => o.text())).toEqual(['Beta'])
  })

  it('shows No matches when filter has no results', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('focus')
    await wrapper.find('.searchable-select-input').setValue('zzz')
    await flushPromises()
    expect(wrapper.find('.searchable-select-empty').exists()).toBe(true)
    expect(wrapper.find('.searchable-select-empty').text()).toBe('No matches')
  })

  it('emits update:modelValue when option is clicked', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('focus')
    await flushPromises()
    const optionButtons = wrapper.findAll('.searchable-select-option')
    expect(optionButtons[1]).toBeDefined()
    await optionButtons[1]!.trigger('mousedown')
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['b2']])
  })

  it('opens on Enter when closed', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.find('.searchable-select-list').exists()).toBe(true)
  })

  it('opens on Space when closed', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('keydown', { key: ' ' })
    await flushPromises()
    expect(wrapper.find('.searchable-select-list').exists()).toBe(true)
  })

  it('opens on ArrowDown when closed', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(wrapper.find('.searchable-select-list').exists()).toBe(true)
  })

  it('closes on Escape', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('focus')
    await flushPromises()
    expect(wrapper.find('.searchable-select').classes()).toContain('open')
    await wrapper.find('.searchable-select-input').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('.searchable-select').classes()).not.toContain('open')
  })

  it('selects highlighted option on Enter', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('focus')
    await flushPromises()
    await wrapper.find('.searchable-select-input').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    await wrapper.find('.searchable-select-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['b2']])
  })

  it('moves highlight with ArrowUp', async () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '' },
    })
    await wrapper.find('.searchable-select-input').trigger('focus')
    await flushPromises()
    await wrapper.find('.searchable-select-input').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    await wrapper.find('.searchable-select-input').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    await wrapper.find('.searchable-select-input').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()
    const highlighted = wrapper.findAll('.searchable-select-option').filter(o => o.attributes('data-highlighted') === 'true')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]!.text()).toBe('Beta')
  })

  it('uses custom placeholder', () => {
    const wrapper = mount(SearchableSoundSelect, {
      props: { options, modelValue: '', placeholder: 'Pick one…' },
    })
    expect(wrapper.find('.searchable-select-input').attributes('placeholder')).toBe('Pick one…')
  })
})
