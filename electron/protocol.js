const fs = require('node:fs')
const path = require('node:path')

/**
 * The Content-Security-Policy every `hibiki://app` response carries (#774).
 * The app origin holds the preload bridge, so this is the layer that keeps a
 * future HTML-injection sink from loading or running anything of its own:
 * - `script-src` also allows `blob:` because the Routed Tab capture worklet
 *   is loaded from a Blob URL (`frontend/src/audio/browser-audio-capture.ts`),
 * - `font-src` also allows `data:` because Vite inlines the smallest
 *   self-hosted font subsets,
 * - `img-src` allows `https:` for Browser tab favicons and Discord guild icons,
 * - `media-src` is the Sound Library stream origin, `hibiki://sound`.
 * `connect-src` stays on the app origin: Discord, GitHub and the Vision
 * Provider are all reached from the backend, never by renderer fetches.
 */
const APP_CONTENT_SECURITY_POLICY = [
  'default-src \'none\'',
  'script-src \'self\' blob:',
  'style-src \'self\' \'unsafe-inline\'',
  'font-src \'self\' data:',
  'img-src \'self\' data: https:',
  'media-src hibiki://sound',
  'connect-src \'self\'',
  'frame-src \'none\'',
  'object-src \'none\'',
  'base-uri \'none\'',
  'form-action \'none\'',
  'frame-ancestors \'none\'',
].join('; ')

/**
 * What a `Range` request header asks of a file of `totalSize` bytes (RFC 9110
 * section 14):
 * - `{ kind: 'full' }` when there is no header, it is not exactly one
 *   `bytes=<start>-[<end>]` or `bytes=-<suffix>` range, or it asks for several
 *   ranges: a server may ignore a Range header, and a 200 with the whole file
 *   is honest where answering only the first range would claim to satisfy the
 *   rest (#784),
 * - `{ kind: 'partial', start, end }` with `end` clamped to the last byte, so
 *   the advertised `Content-Length` matches what the file stream delivers; a
 *   suffix range is the file's last `<suffix>` bytes, the whole file when it is
 *   shorter,
 * - `{ kind: 'unsatisfiable' }` when the range starts past the end of the file
 *   or after its own end, or is an empty suffix (every range on a zero-byte
 *   file), answered with 416.
 *
 * @returns {{ kind: 'full' } | { kind: 'partial', start: number, end: number } | { kind: 'unsatisfiable' }} how to answer the request
 */
function parseRange(rangeHeader, totalSize) {
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/i)
  if (!match || (!match[1] && !match[2]))
    return { kind: 'full' }
  if (!match[1]) {
    const suffix = Number.parseInt(match[2], 10)
    if (suffix === 0 || totalSize === 0)
      return { kind: 'unsatisfiable' }
    // An overflowing suffix parses to Infinity, which clamps to byte 0 here.
    return {
      kind: 'partial',
      start: Math.max(0, totalSize - suffix),
      end: totalSize - 1,
    }
  }
  const start = Number.parseInt(match[1], 10)
  const end = Math.min(
    match[2]
      ? Number.parseInt(match[2], 10)
      : totalSize - 1,
    totalSize - 1,
  )
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= totalSize || start > end)
    return { kind: 'unsatisfiable' }
  return { kind: 'partial', start, end }
}

/**
 * The file under `webDistDir` that serves `hibiki://app<pathname>`. Chromium
 * already resolves `..` segments when it canonicalises the URL, but decoding
 * can turn `..%2F` into a real one, so containment is re-checked after
 * decoding. Anything that is not a regular file (an unknown route, a directory
 * such as `/assets`) falls back to `index.html` for the SPA router. A path the
 * file system refuses to stat is refused rather than thrown out of the
 * protocol handler.
 *
 * @returns {{ ok: true, filePath: string } | { ok: false, reason: string }} the file to serve, or why the URL was refused
 */
function resolveAppPath(webDistDir, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname || '/')
  }
  catch {
    return { ok: false, reason: 'malformed escape' }
  }
  if (decoded.includes('\0'))
    return { ok: false, reason: 'NUL byte' }
  const root = path.resolve(webDistDir)
  const filePath = path.join(root, decoded)
  if (filePath !== root && !filePath.startsWith(root + path.sep))
    return { ok: false, reason: 'outside the app bundle' }
  let stats
  try {
    stats = fs.statSync(filePath, { throwIfNoEntry: false })
  }
  catch (err) {
    // `throwIfNoEntry` only covers ENOENT/ENOTDIR; a segment over NAME_MAX
    // (ENAMETOOLONG), a symlink loop or EACCES still throw (#784).
    return { ok: false, reason: `unreadable path (${err.code ?? err.message})` }
  }
  return {
    ok: true,
    filePath: stats?.isFile()
      ? filePath
      : path.join(root, 'index.html'),
  }
}

module.exports = { APP_CONTENT_SECURITY_POLICY, parseRange, resolveAppPath }
