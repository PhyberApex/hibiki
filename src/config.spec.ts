import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadEnvFile, secretsFromEnvironment } from './config'
import { configuration } from './config/configuration'

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

describe('secretsFromEnvironment', () => {
  it('names each secret the environment supplies, never its value', () => {
    const base = configuration()
    const config = {
      ...base,
      discord: { token: 'env-token' },
      vision: { apiKey: 'sk-env-claude', openaiApiKey: '' },
    }
    expect(secretsFromEnvironment(config)).toEqual(['DISCORD_TOKEN', 'HIBIKI_VISION_API_KEY'])
  })

  it('is empty when every secret comes from Settings', () => {
    const base = configuration()
    expect(secretsFromEnvironment({
      ...base,
      discord: { token: '' },
      vision: { apiKey: '', openaiApiKey: '' },
    })).toEqual([])
  })
})
