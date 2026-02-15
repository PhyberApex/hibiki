import { describe, expect, it } from 'vitest'
import router from './index'

describe('router', () => {
  it('has home route', () => {
    const home = router.getRoutes().find(r => r.name === 'home')
    expect(home).toBeDefined()
    expect(home?.path).toBe('/')
  })

  it('has permissions route', () => {
    const perm = router.getRoutes().find(r => r.name === 'permissions')
    expect(perm).toBeDefined()
    expect(perm?.path).toBe('/permissions')
  })

  it('has about route', () => {
    const about = router.getRoutes().find(r => r.name === 'about')
    expect(about).toBeDefined()
    expect(about?.path).toBe('/about')
  })

  it('registers exactly three routes', () => {
    expect(router.getRoutes()).toHaveLength(3)
  })
})
