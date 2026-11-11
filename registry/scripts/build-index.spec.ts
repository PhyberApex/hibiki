import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(__dirname, 'build-index.mjs')

describe('registry build-index.mjs (#778)', () => {
  let root: string
  let scenesDir: string
  let indexPath: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hibiki-registry-index-'))
    scenesDir = join(root, 'scenes')
    indexPath = join(root, 'index.json')
    mkdirSync(join(scenesDir, 'author'), { recursive: true })
    writeFileSync(join(scenesDir, 'author', 'b.json'), JSON.stringify({ name: 'B', slug: 'b', updatedAt: '2026-02-01T00:00:00Z' }))
    writeFileSync(join(scenesDir, 'author', 'a.json'), JSON.stringify({ name: 'A', slug: 'a', updatedAt: '2026-03-01T00:00:00Z' }))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function run(...extra: string[]): { code: number, output: string } {
    try {
      const stdout = execFileSync(process.execPath, [
        SCRIPT,
        '--scenes',
        scenesDir,
        '--out',
        indexPath,
        ...extra,
      ], { encoding: 'utf-8', stdio: 'pipe' })
      return { code: 0, output: stdout }
    }
    catch (e) {
      const err = e as { status: number, stdout: string, stderr: string }
      return { code: err.status, output: `${err.stdout}${err.stderr}` }
    }
  }

  it('builds a sorted index stamped with the newest entry update', () => {
    expect(run().code).toBe(0)
    const index = JSON.parse(readFileSync(indexPath, 'utf-8'))
    expect(index).toEqual({
      version: 1,
      updatedAt: '2026-03-01T00:00:00Z',
      scenes: [
        expect.objectContaining({ slug: 'a' }),
        expect.objectContaining({ slug: 'b' }),
      ],
    })
  })

  it('--check passes on the index it just built and writes nothing', () => {
    run()
    const before = readFileSync(indexPath, 'utf-8')
    expect(run('--check')).toEqual({
      code: 0,
      output: expect.stringContaining('up to date with 2 scene(s)'),
    })
    expect(readFileSync(indexPath, 'utf-8')).toBe(before)
  })

  it('--check fails on a stale index without rewriting it', () => {
    run()
    writeFileSync(join(scenesDir, 'author', 'c.json'), JSON.stringify({ name: 'C', slug: 'c' }))
    const before = readFileSync(indexPath, 'utf-8')
    expect(run('--check')).toEqual({
      code: 1,
      output: expect.stringContaining('out of date'),
    })
    expect(readFileSync(indexPath, 'utf-8')).toBe(before)
  })

  it('--check fails when there is no index yet', () => {
    expect(run('--check')).toEqual({
      code: 1,
      output: expect.stringContaining('out of date'),
    })
  })

  it('--check passes on the committed registry index', () => {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf-8', stdio: 'pipe' })
    expect(stdout).toContain('up to date')
  })
})
