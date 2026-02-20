import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AboutView from './AboutView.vue'

describe('aboutView', () => {
  it('renders about page heading', () => {
    const wrapper = mount(AboutView)
    expect(wrapper.find('h1').text()).toBe('This is an about page')
  })

  it('has about class on root', () => {
    const wrapper = mount(AboutView)
    expect(wrapper.find('.about').exists()).toBe(true)
  })
})
