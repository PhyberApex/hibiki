import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import AboutView from './AboutView.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div>Home</div>' } },
    { path: '/about', component: AboutView },
  ],
})

describe('aboutView', () => {
  it('renders about page heading', () => {
    const wrapper = mount(AboutView, {
      global: { plugins: [router] },
    })
    expect(wrapper.find('h1').text()).toBe('Hibiki')
  })

  it('has about class on root', () => {
    const wrapper = mount(AboutView, {
      global: { plugins: [router] },
    })
    expect(wrapper.find('.about').exists()).toBe(true)
  })
})
