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
 * What a `Range` request header asks of a file of `totalSize` bytes:
 * - `{ kind: 'full' }` when there is no header or it is not a `bytes=<start>-[<end>]` range,
 * - `{ kind: 'partial', start, end }` with `end` clamped to the last byte, so
 *   the advertised `Content-Length` matches what the file stream delivers,
 * - `{ kind: 'unsatisfiable' }` when the range starts past the end of the file
 *   or after its own end (every range on a zero-byte file), answered with 416.
 *
 * @returns {{ kind: 'full' } | { kind: 'partial', start: number, end: number } | { kind: 'unsatisfiable' }} how to answer the request
 */
function parseRange(rangeHeader, totalSize) {
  const match = rangeHeader?.match(/bytes=(\d+)-(\d*)/)
  if (!match)
    return { kind: 'full' }
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
 * such as `/assets`) falls back to `index.html` for the SPA router.
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
  return {
    ok: true,
    filePath: fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()
      ? filePath
      : path.join(root, 'index.html'),
  }
}

module.exports = { APP_CONTENT_SECURITY_POLICY, parseRange, resolveAppPath }
