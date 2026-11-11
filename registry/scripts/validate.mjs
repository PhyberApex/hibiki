#!/usr/bin/env node

/**
 * Validates all scene entries in a scenes directory (default registry/scenes/)
 * against registry/schema/scene-entry.schema.json with a real JSON Schema
 * validator (types, nested additionalProperties, minLength, formats, $defs),
 * then the checks a schema cannot express: slug matches filename, slug
 * uniqueness and at least one track per scene.
 *
 * The schema is always the one next to this script, never one from the
 * scenes directory: CI validates a PR's entries with the base branch's
 * scripts and schema so a submission cannot loosen its own gate (#778).
 *
 * Usage: node registry/scripts/validate.mjs [--scenes <dir>]
 */

import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join, relative as relativePath, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import addFormats from 'ajv-formats'
import Ajv2020 from 'ajv/dist/2020.js'

const REGISTRY_DIR = resolve(import.meta.dirname, '..')
const SCHEMA_PATH = join(REGISTRY_DIR, 'schema', 'scene-entry.schema.json')

const { values: args } = parseArgs({
  options: {
    scenes: { type: 'string' },
  },
})
const SCENES_DIR = resolve(args.scenes ?? join(REGISTRY_DIR, 'scenes'))

const errors = []

function collectJsonFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(full))
    }
    else if (entry.isFile() && extname(entry.name) === '.json') {
      files.push(full)
    }
  }
  return files
}

function describeSchemaError(error) {
  const at = error.instancePath || '(root)'
  if (error.keyword === 'additionalProperties')
    return `${at}: unknown field "${error.params.additionalProperty}"`
  if (error.keyword === 'const' && error.instancePath === '/audioBundled')
    return `${at}: must be false — the registry does not accept scenes that bundle audio files`
  return `${at}: ${error.message}`
}

function validateEntry(filePath, validateSchema) {
  const relative = relativePath(SCENES_DIR, filePath)
  let data
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'))
  }
  catch (e) {
    errors.push(`${relative}: Invalid JSON — ${e.message}`)
    return null
  }

  if (!validateSchema(data)) {
    for (const error of validateSchema.errors)
      errors.push(`${relative}: ${describeSchemaError(error)}`)
    return null
  }

  const expectedSlug = basename(filePath, '.json')
  if (data.slug !== expectedSlug) {
    errors.push(`${relative}: Slug "${data.slug}" does not match filename "${expectedSlug}.json"`)
  }

  const totalTracks = data.scene.music.length + data.scene.ambience.length + data.scene.effects.length
  if (totalTracks === 0) {
    errors.push(`${relative}: Scene must have at least one track across music, ambience, or effects`)
  }

  return data
}

// Main
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validateSchema = ajv.compile(schema)

let sceneFiles
try {
  sceneFiles = collectJsonFiles(SCENES_DIR)
}
catch {
  sceneFiles = []
}

if (sceneFiles.length === 0) {
  console.warn(`No scene entries found in ${SCENES_DIR} — nothing to validate.`)
  process.exit(0)
}

const slugs = new Map()

for (const file of sceneFiles) {
  const data = validateEntry(file, validateSchema)
  if (!data)
    continue

  const relative = relativePath(SCENES_DIR, file)
  if (slugs.has(data.slug)) {
    errors.push(`${relative}: Duplicate slug "${data.slug}" (also in ${slugs.get(data.slug)})`)
  }
  else {
    slugs.set(data.slug, relative)
  }
}

if (errors.length > 0) {
  console.error(`\nRegistry validation failed with ${errors.length} error(s):\n`)
  for (const err of errors) {
    console.error(`  - ${err}`)
  }
  process.exit(1)
}
else {
  console.log(`Validated ${sceneFiles.length} scene(s) — all OK.`)
}
