import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseRange, resolveAppPath } from './protocol'

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

  const index = () => path.join(webDistDir, 'index.html')

  it('serves index.html for the root', () => {
    expect(resolveAppPath(webDistDir, '/')).toBe(index())
  })

  it('serves an existing asset', () => {
    expect(resolveAppPath(webDistDir, '/assets/index-abc.js')).toBe(path.join(webDistDir, 'assets', 'index-abc.js'))
  })

  it('falls back to index.html for an unknown route', () => {
    expect(resolveAppPath(webDistDir, '/settings')).toBe(index())
  })

  it('falls back to index.html for a directory instead of streaming it', () => {
    expect(resolveAppPath(webDistDir, '/assets')).toBe(index())
    expect(resolveAppPath(webDistDir, '/assets/')).toBe(index())
  })

  it('decodes a percent-encoded asset name', () => {
    const pathname = new URL('hibiki://app/assets/font name+1.woff2').pathname
    expect(pathname).toBe('/assets/font%20name+1.woff2')
    expect(resolveAppPath(webDistDir, pathname)).toBe(path.join(webDistDir, 'assets', 'font name+1.woff2'))
  })

  it('relies on URL canonicalisation to resolve literal and %2e dot segments', () => {
    for (const url of ['hibiki://app/../../etc/passwd', 'hibiki://app/%2e%2e/%2E%2E/etc/passwd']) {
      const { pathname } = new URL(url)
      expect(pathname).toBe('/etc/passwd')
      expect(resolveAppPath(webDistDir, pathname)).toBe(index())
    }
  })

  it('refuses a pathname that only escapes once decoded', () => {
    const { pathname } = new URL('hibiki://app/..%2F..%2Fetc%2Fpasswd')
    expect(pathname).toBe('/..%2F..%2Fetc%2Fpasswd')
    expect(resolveAppPath(webDistDir, pathname)).toBeNull()
    expect(resolveAppPath(webDistDir, '/..%5C..%5Cetc')).toBe(
      path.sep === '\\'
        ? null
        : index(),
    )
  })

  it('refuses a malformed escape or a NUL byte', () => {
    expect(resolveAppPath(webDistDir, '/assets/%E0%A4%A')).toBeNull()
    expect(resolveAppPath(webDistDir, '/index.html%00.js')).toBeNull()
  })
})
