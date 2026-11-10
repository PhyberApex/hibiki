import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertNoStrayAppFiles, ignoreAppFile } from './app-files'

// Packager hands the filter paths relative to the project root, `/`-separated, with a leading `/`.
describe('ignoreAppFile', () => {
  it.each([
    '/.env',
    '/.env.e2e',
    '/.env.local',
    '/.secrets',
    '/.actrc',
    '/.claude',
    '/.claude/settings.json',
    '/.cursor',
    '/.idea',
    '/.impeccable',
    '/.github',
    '/.git',
    '/agent-docs',
    '/marketing',
    '/packaging',
    '/registry',
    '/coverage',
    '/src',
    '/src/config.ts',
    '/frontend',
    '/frontend/src/main.ts',
    '/e2e',
    '/docs',
    '/out',
    '/release',
    '/storage',
    '/.pnpm-store',
    '/CLAUDE.md',
    '/README.md',
    '/forge.config.js',
    '/forge',
    '/jest.config.js',
    '/tsconfig.json',
    '/tsconfig.tsbuildinfo',
    '/pnpm-lock.yaml',
    '/some-new-file-nobody-thought-of',
  ])('keeps %s out of the app', (file) => {
    expect(ignoreAppFile(file)).toBe(true)
  })

  it.each([
    '',
    '/package.json',
    '/dist',
    '/dist/bootstrap-embedded.js',
    '/dist/config/config.js',
    '/web-dist',
    '/web-dist/index.html',
    '/web-dist/assets/index-abc123.js',
    '/electron',
    '/electron/main.js',
    '/electron/preload.js',
    '/node_modules',
    '/node_modules/discord.js/package.json',
    '/node_modules/@snazzah/davey/davey.linux-x64-gnu.node',
  ])('ships %s', (file) => {
    expect(ignoreAppFile(file)).toBe(false)
  })

  it.each([
    '/electron/main.spec.ts',
    '/electron/permissions.spec.ts',
    '/dist/foo.test.js',
    '/web-dist/assets/index-abc123.js.map',
    '/node_modules/.bin',
    '/node_modules/.bin/tsc',
    '/node_modules/some-native/build/Release/obj/foo.o',
    '/node_modules/some-native/build/node_gyp_bins',
    '/node_modules/.env',
    '/dist/.env',
  ])('drops %s inside a shipped directory', (file) => {
    expect(ignoreAppFile(file)).toBe(true)
  })

  it('does not ship a top-level name that only starts like an allowed one', () => {
    expect(ignoreAppFile('/dist-old')).toBe(true)
    expect(ignoreAppFile('/electron-notes.md')).toBe(true)
    expect(ignoreAppFile('/package.json.bak')).toBe(true)
  })
})

describe('assertNoStrayAppFiles', () => {
  let buildPath: string

  beforeEach(() => {
    buildPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-app-files-'))
    for (const dir of [
      'dist',
      'web-dist',
      'electron',
      'node_modules/dotenv',
    ])
      fs.mkdirSync(path.join(buildPath, dir), { recursive: true })
    fs.writeFileSync(path.join(buildPath, 'package.json'), '{}')
    fs.writeFileSync(path.join(buildPath, 'electron', 'main.js'), '')
  })

  afterEach(() => fs.rmSync(buildPath, { recursive: true, force: true }))

  it('passes a copied app holding only the allowlisted entries', async () => {
    await expect(assertNoStrayAppFiles({ buildPath })).resolves.toBeUndefined()
  })

  it('fails packaging when a .env reached the copied app', async () => {
    fs.writeFileSync(path.join(buildPath, '.env'), 'DISCORD_TOKEN=secret')
    await expect(assertNoStrayAppFiles({ buildPath })).rejects.toThrow(/\.env/)
  })

  it('fails packaging when a .env is nested in a shipped directory', async () => {
    fs.writeFileSync(path.join(buildPath, 'electron', '.env.local'), 'DISCORD_TOKEN=secret')
    await expect(assertNoStrayAppFiles({ buildPath })).rejects.toThrow(/electron\/\.env\.local/)
  })

  it('fails packaging on any top-level entry outside the allowlist', async () => {
    fs.mkdirSync(path.join(buildPath, 'agent-docs'))
    await expect(assertNoStrayAppFiles({ buildPath })).rejects.toThrow(/agent-docs/)
  })

  it('never reports the secret file contents', async () => {
    fs.writeFileSync(path.join(buildPath, '.secrets'), 'DISCORD_TOKEN=super-secret-value')
    await expect(assertNoStrayAppFiles({ buildPath })).rejects.not.toThrow(/super-secret-value/)
  })
})
