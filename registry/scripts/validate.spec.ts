import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(__dirname, 'validate.mjs')

function validEntry(): Record<string, any> {
  return {
    name: 'Cozy Tavern',
    slug: 'cozy-tavern',
    description: 'A warm tavern.',
    author: 'someone',
    version: '1.0.0',
    tags: ['tavern'],
    category: 'environment',
    audioBundled: false,
    createdAt: '2026-03-18T00:00:00Z',
    updatedAt: '2026-03-18T00:00:00Z',
    scene: {
      music: [
        {
          soundName: 'Bard',
          volume: 60,
          loop: true,
          source: { name: 'Lute song' },
        },
      ],
      ambience: [],
      effects: [],
    },
  }
}

describe('registry validate.mjs (#778)', () => {
  let scenesDir: string

  beforeEach(() => {
    scenesDir = mkdtempSync(join(tmpdir(), 'hibiki-registry-validate-'))
    mkdirSync(join(scenesDir, 'author'))
  })

  afterEach(() => {
    rmSync(scenesDir, { recursive: true, force: true })
  })

  function writeEntry(file: string, data: unknown) {
    writeFileSync(join(scenesDir, 'author', file), typeof data === 'string'
      ? data
      : JSON.stringify(data))
  }

  function run(): { code: number, output: string } {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, '--scenes', scenesDir], { encoding: 'utf-8', stdio: 'pipe' })
      return { code: 0, output: stdout }
    }
    catch (e) {
      const err = e as { status: number, stdout: string, stderr: string }
      return { code: err.status, output: `${err.stdout}${err.stderr}` }
    }
  }

  it('accepts a well-formed entry', () => {
    writeEntry('cozy-tavern.json', validEntry())
    expect(run()).toEqual({
      code: 0,
      output: expect.stringContaining('Validated 1 scene(s)'),
    })
  })

  it('accepts the entries shipped in the registry', () => {
    const stdout = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf-8', stdio: 'pipe' })
    expect(stdout).toContain('all OK')
  })

  it.each([
    [
      'a non-string author',
      (e: any) => { e.author = 42 },
      '/author: must be string',
    ],
    [
      'tags given as a string',
      (e: any) => { e.tags = 'spooky' },
      '/tags: must be array',
    ],
    [
      'an object name',
      (e: any) => { e.name = {} },
      '/name: must be string',
    ],
    [
      'an empty description',
      (e: any) => { e.description = '' },
      '/description: must NOT have fewer than 1 characters',
    ],
    [
      'an empty tag',
      (e: any) => { e.tags = [''] },
      '/tags/0: must NOT have fewer than 1 characters',
    ],
    [
      'no tags',
      (e: any) => { e.tags = [] },
      '/tags: must NOT have fewer than 1 items',
    ],
    [
      'a non-date timestamp',
      (e: any) => { e.updatedAt = 'yesterday' },
      '/updatedAt: must match format "date-time"',
    ],
    [
      'a non-semver version',
      (e: any) => { e.version = '1.0' },
      '/version: must match pattern',
    ],
    [
      'an unknown top-level field',
      (e: any) => { e.hotkey = 'F1' },
      '(root): unknown field "hotkey"',
    ],
    [
      'an unknown scene field',
      (e: any) => { e.scene.extra = [] },
      '/scene: unknown field "extra"',
    ],
    [
      'an unknown track field',
      (e: any) => { e.scene.music[0].hotkey = 'F2' },
      '/scene/music/0: unknown field "hotkey"',
    ],
    [
      'an unknown source field',
      (e: any) => { e.scene.music[0].source.file = 'x.mp3' },
      '/scene/music/0/source: unknown field "file"',
    ],
    [
      'a track without a source',
      (e: any) => { delete e.scene.music[0].source },
      '/scene/music/0: must have required property \'source\'',
    ],
    [
      'a volume above 100',
      (e: any) => { e.scene.music[0].volume = 101 },
      '/scene/music/0/volume: must be <= 100',
    ],
    [
      'a string loop flag',
      (e: any) => { e.scene.music[0].loop = 'yes' },
      '/scene/music/0/loop: must be boolean',
    ],
    [
      'a non-object track',
      (e: any) => { e.scene.effects = [null] },
      '/scene/effects/0: must be object',
    ],
    [
      'an unknown Music Mode',
      (e: any) => { e.scene.musicMode = 'random' },
      '/scene/musicMode: must be equal to one of the allowed values',
    ],
    [
      'bundled audio',
      (e: any) => { e.audioBundled = true },
      '/audioBundled: must be false',
    ],
    [
      'a missing ambience list',
      (e: any) => { delete e.scene.ambience },
      '/scene: must have required property \'ambience\'',
    ],
  ])('rejects %s', (_label, mutate, message) => {
    const entry = validEntry()
    mutate(entry)
    writeEntry('cozy-tavern.json', entry)
    const result = run()
    expect(result.code).toBe(1)
    expect(result.output).toContain(`author/cozy-tavern.json: ${message}`)
  })

  it('rejects a top-level value that is not an object', () => {
    writeEntry('cozy-tavern.json', 'null')
    expect(run()).toEqual({
      code: 1,
      output: expect.stringContaining('(root): must be object'),
    })
  })

  it('rejects invalid JSON', () => {
    writeEntry('cozy-tavern.json', '{ broken')
    expect(run()).toEqual({
      code: 1,
      output: expect.stringContaining('Invalid JSON'),
    })
  })

  it('rejects a slug that does not match the filename', () => {
    writeEntry('other-name.json', validEntry())
    expect(run()).toEqual({
      code: 1,
      output: expect.stringContaining('does not match filename "other-name.json"'),
    })
  })

  it('rejects a scene without any track', () => {
    const entry = validEntry()
    entry.scene.music = []
    writeEntry('cozy-tavern.json', entry)
    expect(run()).toEqual({
      code: 1,
      output: expect.stringContaining('at least one track'),
    })
  })

  it('rejects a duplicate slug across authors', () => {
    writeEntry('cozy-tavern.json', validEntry())
    mkdirSync(join(scenesDir, 'other'))
    writeFileSync(join(scenesDir, 'other', 'cozy-tavern.json'), JSON.stringify(validEntry()))
    expect(run()).toEqual({
      code: 1,
      output: expect.stringContaining('Duplicate slug "cozy-tavern"'),
    })
  })

  it('passes with a warning when there is nothing to validate', () => {
    expect(run()).toEqual({ code: 0, output: '' })
  })
})
