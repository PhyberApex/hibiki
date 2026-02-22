import { readFileSync } from 'node:fs'
import { getVersion } from './version'

jest.mock('node:fs', () => ({
  readFileSync: jest.fn(),
}))

describe('version', () => {
  it('returns version from root package.json when readable', () => {
    const read = jest.mocked(readFileSync)
    read.mockReturnValueOnce(JSON.stringify({ version: '2.0.0' }))
    expect(getVersion()).toBe('2.0.0')
  })

  it('falls back to local package.json when root read fails', () => {
    const read = jest.mocked(readFileSync)
    read.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    read.mockReturnValueOnce(JSON.stringify({ version: '1.0.0' }))
    expect(getVersion()).toBe('1.0.0')
  })

  it('returns 0.0.0 when both reads fail', () => {
    const read = jest.mocked(readFileSync)
    read.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(getVersion()).toBe('0.0.0')
  })

  it('returns 0.0.0 when version field is missing', () => {
    const read = jest.mocked(readFileSync)
    read.mockReturnValueOnce(JSON.stringify({}))
    expect(getVersion()).toBe('0.0.0')
  })
})
