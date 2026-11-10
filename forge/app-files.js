/**
 * What goes into the packaged app (`app.asar`), for `forge.config.js`.
 *
 * An allowlist, not a denylist (#764): a denylist shipped every file nobody thought to
 * name, including a maintainer's gitignored `.env` with a live DISCORD_TOKEN. Anything
 * the runtime needs must sit in one of `SHIPPED_ROOTS`; a new top-level file or folder
 * stays out of the app until it is added here.
 */
const fs = require('node:fs')
const path = require('node:path')

/** Top-level entries the packaged app loads at runtime. */
const SHIPPED_ROOTS = new Set([
  'dist',
  'web-dist',
  'electron',
  'node_modules',
  'package.json',
])

/** Secret-bearing files, dropped wherever they sit (`.env`, `.env.e2e`, `.secrets`, ...). */
const SECRET_FILE = /^\.(?:env(?:\..*)?|secrets)$/

/**
 * Dropped inside the shipped roots. Supplying an `ignore` function replaces Packager's
 * DEFAULT_IGNORES, so its `node_modules/.bin`, object-file and `node_gyp_bins` entries
 * are repeated here.
 */
const IGNORED_WITHIN = [
  /\.map$/,
  /\.spec\./,
  /\.test\./,
  /tsconfig/,
  /^\/node_modules\/\.bin(?:$|\/)/,
  /\.o(?:bj)?$/,
  /\/node_gyp_bins(?:$|\/)/,
]

/**
 * Packager's `ignore` callback. `file` is relative to the project root, `/`-separated with a
 * leading `/`; the root itself arrives as `''` and must not be ignored.
 */
function ignoreAppFile(file) {
  if (file === '')
    return false
  const top = file.split('/')[1]
  if (!SHIPPED_ROOTS.has(top))
    return true
  if (SECRET_FILE.test(path.posix.basename(file)))
    return true
  return IGNORED_WITHIN.some(pattern => pattern.test(file))
}

/** Secret files under `dir`, as `/`-separated paths relative to `root`. Skips `node_modules`. */
async function findSecretFiles(root, dir = root) {
  const found = []
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules')
        found.push(...await findSecretFiles(root, full))
    }
    else if (SECRET_FILE.test(entry.name)) {
      found.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  return found
}

/**
 * Packager `afterCopy` hook: inspects the copied app before it is sealed into `app.asar` and
 * fails packaging if anything outside the allowlist or any secret file got through, so a
 * regression in `ignoreAppFile` (or a Packager change in how it applies it) breaks the build
 * instead of shipping a token. Reports paths only, never contents.
 */
async function assertNoStrayAppFiles({ buildPath }) {
  const entries = await fs.promises.readdir(buildPath)
  const stray = entries.filter(name => !SHIPPED_ROOTS.has(name))
  const secrets = (await findSecretFiles(buildPath)).filter(file => !stray.includes(file))
  const offending = [
    ...stray,
    ...secrets,
  ]
  if (offending.length > 0)
    throw new Error(`Refusing to package: files outside the app allowlist reached ${buildPath}: ${offending.join(', ')} (see forge/app-files.js)`)
}

module.exports = {
  assertNoStrayAppFiles,
  ignoreAppFile,
}
