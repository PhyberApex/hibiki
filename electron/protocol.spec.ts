import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { APP_CONTENT_SECURITY_POLICY, parseRange, resolveAppPath } from './protocol'

describe('parseRange', () => {
  it('serves the whole file without a parseable range', () => {
    expect(parseRange(null, 100)).toEqual({ kind: 'full' })
    expect(parseRange('bytes=-500', 100)).toEqual({ kind: 'full' })
    expect(parseRange('items=0-1', 100)).toEqual({ kind: 'full' })
  })

  it('reads an open-ended range to the last byte', () => {
    expect(parseRange('bytes=10-', 100)).toEqual({ kind: 'partial', start: 10, end: 99 })
  })

  it('keeps an in-bounds range as asked', () => {
    expect(parseRange('bytes=0-49', 100)).toEqual({ kind: 'partial', start: 0, end: 49 })
    expect(parseRange('bytes=99-99', 100)).toEqual({ kind: 'partial', start: 99, end: 99 })
  })

  it('clamps an over-long end to the last byte', () => {
    expect(parseRange('bytes=0-999999999', 100)).toEqual({ kind: 'partial', start: 0, end: 99 })
    expect(parseRange(`bytes=0-${'9'.repeat(400)}`, 100)).toEqual({ kind: 'partial', start: 0, end: 99 })
  })

  it('refuses a start beyond the size or after the end', () => {
    expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=500-600', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=50-10', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange(`bytes=${'9'.repeat(400)}-`, 100)).toEqual({ kind: 'unsatisfiable' })
  })

  it('refuses every range on a zero-byte file', () => {
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' })
  })
})

describe('resolveAppPath', () => {
  let webDistDir: string

  beforeAll(() => {
    webDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-web-dist-'))
    fs.mkdirSync(path.join(webDistDir, 'assets'))
    fs.writeFileSync(path.join(webDistDir, 'index.html'), '<!doctype html>')
    fs.writeFileSync(path.join(webDistDir, 'assets', 'index-abc.js'), '')
    fs.writeFileSync(path.join(webDistDir, 'assets', 'font name+1.woff2'), '')
  })

  afterAll(() => {
    fs.rmSync(webDistDir, { recursive: true, force: true })
  })

  const index = () => ({
    ok: true,
    filePath: path.join(webDistDir, 'index.html'),
  })
  const file = (...segments: string[]) => ({
    ok: true,
    filePath: path.join(webDistDir, ...segments),
  })
  const refused = (reason: string) => ({ ok: false, reason })

  it('serves index.html for the root', () => {
    expect(resolveAppPath(webDistDir, '/')).toEqual(index())
  })

  it('serves an existing asset', () => {
    expect(resolveAppPath(webDistDir, '/assets/index-abc.js')).toEqual(file('assets', 'index-abc.js'))
  })

  it('falls back to index.html for an unknown route', () => {
    expect(resolveAppPath(webDistDir, '/settings')).toEqual(index())
  })

  it('falls back to index.html for a directory instead of streaming it', () => {
    expect(resolveAppPath(webDistDir, '/assets')).toEqual(index())
    expect(resolveAppPath(webDistDir, '/assets/')).toEqual(index())
  })

  it('decodes a percent-encoded asset name', () => {
    const pathname = new URL('hibiki://app/assets/font name+1.woff2').pathname
    expect(pathname).toBe('/assets/font%20name+1.woff2')
    expect(resolveAppPath(webDistDir, pathname)).toEqual(file('assets', 'font name+1.woff2'))
  })

  it('relies on URL canonicalisation to resolve literal and %2e dot segments', () => {
    for (const url of ['hibiki://app/../../etc/passwd', 'hibiki://app/%2e%2e/%2E%2E/etc/passwd']) {
      const { pathname } = new URL(url)
      expect(pathname).toBe('/etc/passwd')
      expect(resolveAppPath(webDistDir, pathname)).toEqual(index())
    }
  })

  it('refuses a pathname that only escapes once decoded', () => {
    const { pathname } = new URL('hibiki://app/..%2F..%2Fetc%2Fpasswd')
    expect(pathname).toBe('/..%2F..%2Fetc%2Fpasswd')
    expect(resolveAppPath(webDistDir, pathname)).toEqual(refused('outside the app bundle'))
    expect(resolveAppPath(webDistDir, '/..%5C..%5Cetc')).toEqual(
      path.sep === '\\'
        ? refused('outside the app bundle')
        : index(),
    )
  })

  it('refuses a malformed escape or a NUL byte', () => {
    expect(resolveAppPath(webDistDir, '/assets/%E0%A4%A')).toEqual(refused('malformed escape'))
    expect(resolveAppPath(webDistDir, '/index.html%00.js')).toEqual(refused('NUL byte'))
  })
})

describe('the app Content-Security-Policy', () => {
  const directives = new Map(
    APP_CONTENT_SECURITY_POLICY.split(';').map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/)
      return [name, sources] as const
    }),
  )

  it('denies everything not named explicitly', () => {
    expect(directives.get('default-src')).toEqual(['\'none\''])
  })

  it('runs only the app bundle\'s own scripts, never inline ones or another origin\'s', () => {
    expect(directives.get('script-src')).toEqual(['\'self\'', 'blob:'])
  })

  it('loads styles and fonts from the app bundle alone, with no remote font origin', () => {
    expect(directives.get('style-src')).toEqual(['\'self\'', '\'unsafe-inline\''])
    expect(directives.get('font-src')).toEqual(['\'self\'', 'data:'])
  })

  it('streams media from hibiki://sound only', () => {
    expect(directives.get('media-src')).toEqual(['hibiki://sound'])
  })

  it('keeps the renderer off the network and out of frames, plugins and form posts', () => {
    expect(directives.get('connect-src')).toEqual(['\'self\''])
    for (const name of [
      'frame-src',
      'object-src',
      'base-uri',
      'form-action',
      'frame-ancestors',
    ])
      expect(directives.get(name)).toEqual(['\'none\''])
  })
})
