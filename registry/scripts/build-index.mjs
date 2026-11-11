#!/usr/bin/env node

/**
 * Reads all scene entries from a scenes directory (default registry/scenes/)
 * and builds the index (default registry/index.json).
 *
 * With --check it writes nothing and exits 1 when the index on disk differs
 * from the one it would build: CI uses that, so the committed index is always
 * the one the entries produce and no workflow needs a write token (#778).
 *
 * Usage: node registry/scripts/build-index.mjs [--scenes <dir>] [--out <file>] [--check]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { collectJsonFiles } from './scene-files.mjs'

const REGISTRY_DIR = resolve(import.meta.dirname, '..')

const { values: args } = parseArgs({
  options: {
    scenes: { type: 'string' },
    out: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
})
const SCENES_DIR = resolve(args.scenes ?? join(REGISTRY_DIR, 'scenes'))
const INDEX_PATH = resolve(args.out ?? join(REGISTRY_DIR, 'index.json'))

let sceneFiles
try {
  sceneFiles = collectJsonFiles(SCENES_DIR)
}
catch {
  // scenes dir may be empty or not exist
  sceneFiles = []
}
const scenes = []

for (const file of sceneFiles) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'))
    scenes.push(data)
  }
  catch (e) {
    console.error(`Skipping ${file}: ${e.message}`)
  }
}

scenes.sort((a, b) => (a.name || '').localeCompare(b.name || ''))

// Derived from the entries rather than the clock so rebuilding an unchanged
// registry yields a byte-identical index (CI compares the committed file).
const updatedAt = scenes
  .map(s => s.updatedAt)
  .filter(Boolean)
  .sort()
  .at(-1) ?? new Date(0).toISOString()

const index = {
  version: 1,
  updatedAt,
  scenes,
}

const built = `${JSON.stringify(index, null, 2)}\n`

if (args.check) {
  let current = null
  try {
    current = readFileSync(INDEX_PATH, 'utf-8')
  }
  catch {
    // a missing index is out of date
  }
  if (current !== built) {
    console.error(`${INDEX_PATH} is out of date with its ${scenes.length} scene(s). Run \`pnpm registry:build-index\` and commit registry/index.json.`)
    process.exit(1)
  }
  console.log(`index.json is up to date with ${scenes.length} scene(s).`)
}
else {
  writeFileSync(INDEX_PATH, built, 'utf-8')
  console.log(`Built index.json with ${scenes.length} scene(s).`)
}
