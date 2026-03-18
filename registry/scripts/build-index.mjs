#!/usr/bin/env node

/**
 * Reads all scene entries from registry/scenes/ and builds registry/index.json.
 *
 * Usage: node registry/scripts/build-index.mjs
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const REGISTRY_DIR = resolve(import.meta.dirname, '..')
const SCENES_DIR = join(REGISTRY_DIR, 'scenes')
const INDEX_PATH = join(REGISTRY_DIR, 'index.json')

function collectJsonFiles(dir) {
  const files = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...collectJsonFiles(full))
      }
      else if (entry.isFile() && extname(entry.name) === '.json') {
        files.push(full)
      }
    }
  }
  catch {
    // scenes dir may be empty or not exist
  }
  return files
}

const sceneFiles = collectJsonFiles(SCENES_DIR)
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

const index = {
  version: 1,
  updatedAt: new Date().toISOString(),
  scenes,
}

writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf-8')
console.log(`Built index.json with ${scenes.length} scene(s).`)
