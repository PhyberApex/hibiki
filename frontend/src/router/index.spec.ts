import { describe, expect, it } from 'vitest'
import router from './index'

describe('router', () => {
  it('has welcome route at /', () => {
    const root = router.getRoutes().find(r => r.path === '/')
    expect(root).toBeDefined()
    expect(root?.name).toBe('welcome')
  })

  it('has media route', () => {
    const media = router.getRoutes().find(r => r.name === 'media')
    expect(media).toBeDefined()
    expect(media?.path).toBe('/media')
  })

  it('has about route', () => {
    const about = router.getRoutes().find(r => r.name === 'about')
    expect(about).toBeDefined()
    expect(about?.path).toBe('/about')
  })

  it('has settings route', () => {
    const settings = router.getRoutes().find(r => r.name === 'settings')
    expect(settings).toBeDefined()
    expect(settings?.path).toBe('/settings')
  })

  it('registers scenes routes', () => {
    const scenes = router.getRoutes().find(r => r.name === 'scenes')
    expect(scenes).toBeDefined()
    expect(scenes?.path).toBe('/scenes')
    const scene = router.getRoutes().find(r => r.name === 'scene')
    expect(scene).toBeDefined()
    expect(scene?.path).toBe('/scenes/:id')
  })
})
