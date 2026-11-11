import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadEnvFile } from './config'

describe('loadEnvFile', () => {
  const originalCwd = process.cwd()
  const probe = 'HIBIKI_CONFIG_SPEC_PROBE'

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'hibiki-config-'))
    writeFileSync(join(dir, '.env'), `${probe}=from-cwd\n`)
    process.chdir(dir)
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    process.chdir(originalCwd)
    delete process.env[probe]
    jest.restoreAllMocks()
  })

  it('never reads a .env from the working directory (#776)', () => {
    loadEnvFile({ packaged: false })
    expect(process.env[probe]).toBeUndefined()
  })

  it('reads only the repository-root .env in an unpackaged build', () => {
    expect(loadEnvFile({ packaged: false })).toBe(resolve(__dirname, '..', '.env'))
  })

  it('reads no .env at all in a packaged build', () => {
    expect(loadEnvFile({ packaged: true })).toBeNull()
    expect(process.env[probe]).toBeUndefined()
  })
})
