import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HotkeyRecorder from './HotkeyRecorder.vue'

function mountRecorder(props: { modelValue?: string, error?: string | null } = {}) {
  return mount(HotkeyRecorder, { props: { label: 'Scene Hotkey', ...props } })
}

const button = (w: ReturnType<typeof mountRecorder>) => w.find('[data-testid="hotkey-recorder-button"]')

describe('hotkeyRecorder', () => {
  it('captures the next key combination after arming and emits an accelerator', async () => {
    const wrapper = mountRecorder()
    await button(wrapper).trigger('click')
    expect(button(wrapper).text()).toContain('Press a key')
    await button(wrapper).trigger('keydown', { code: 'KeyK', ctrlKey: true, shiftKey: true })
    expect(wrapper.emitted('update:modelValue')).toEqual([['Ctrl+Shift+K']])
    expect(button(wrapper).text()).not.toContain('Press a key')
  })

  it('records F13 on its own', async () => {
    const wrapper = mountRecorder()
    await button(wrapper).trigger('click')
    await button(wrapper).trigger('keydown', { code: 'F13' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['F13']])
  })

  it('keeps waiting while only a modifier is held', async () => {
    const wrapper = mountRecorder()
    await button(wrapper).trigger('click')
    await button(wrapper).trigger('keydown', { code: 'ControlLeft', ctrlKey: true })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(button(wrapper).text()).toContain('Press a key')
  })

  it('ignores keys while not armed', async () => {
    const wrapper = mountRecorder()
    await button(wrapper).trigger('keydown', { code: 'F13' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('cancels on Escape without changing the binding', async () => {
    const wrapper = mountRecorder({ modelValue: 'F14' })
    await button(wrapper).trigger('click')
    await button(wrapper).trigger('keydown', { code: 'Escape', key: 'Escape' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(button(wrapper).text()).toContain('F14')
  })

  it('clears the binding with the clear button', async () => {
    const wrapper = mountRecorder({ modelValue: 'F14' })
    await wrapper.find('[data-testid="hotkey-recorder-clear"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[undefined]])
  })

  it('has no clear button when unbound', () => {
    expect(mountRecorder().find('[data-testid="hotkey-recorder-clear"]').exists()).toBe(false)
  })

  it('warns inline on a bare letter or digit but not on F-keys or modifier combos', () => {
    expect(mountRecorder({ modelValue: 'K' }).find('[data-testid="hotkey-recorder-warning"]').exists()).toBe(true)
    expect(mountRecorder({ modelValue: '5' }).find('[data-testid="hotkey-recorder-warning"]').exists()).toBe(true)
    expect(mountRecorder({ modelValue: 'F13' }).find('[data-testid="hotkey-recorder-warning"]').exists()).toBe(false)
    expect(mountRecorder({ modelValue: 'Ctrl+K' }).find('[data-testid="hotkey-recorder-warning"]').exists()).toBe(false)
  })

  it('shows a rejection inline and announces the armed state', async () => {
    const wrapper = mountRecorder({ error: 'F13 is already used by Scene \'Tavern\'' })
    expect(wrapper.find('[data-testid="hotkey-recorder-error"]').text()).toContain('Tavern')
    await button(wrapper).trigger('click')
    expect(wrapper.find('[role="status"]').text()).toContain('Recording Scene Hotkey')
  })
})
