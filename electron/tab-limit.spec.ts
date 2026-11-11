import { assertTabCapacity, MAX_BROWSER_TABS } from './tab-limit'

const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

afterEach(() => jest.clearAllMocks())
afterAll(() => jest.restoreAllMocks())

describe('assertTabCapacity (#783)', () => {
  it('lets a tab open while fewer than MAX_BROWSER_TABS are open', () => {
    expect(() => assertTabCapacity(0)).not.toThrow()
    expect(() => assertTabCapacity(MAX_BROWSER_TABS - 1)).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })

  it('refuses and logs once MAX_BROWSER_TABS are open', () => {
    expect(() => assertTabCapacity(MAX_BROWSER_TABS)).toThrow(`at most ${MAX_BROWSER_TABS}`)
    expect(() => assertTabCapacity(MAX_BROWSER_TABS + 5)).toThrow()
    expect(warn).toHaveBeenCalledWith('[browser]', expect.stringContaining(`${MAX_BROWSER_TABS} tab(s) already open`))
  })

  it('keeps the ceiling in single digits plus a little headroom', () => {
    expect(MAX_BROWSER_TABS).toBeGreaterThanOrEqual(8)
    expect(MAX_BROWSER_TABS).toBeLessThanOrEqual(16)
  })
})
