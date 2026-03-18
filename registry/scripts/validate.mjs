#!/usr/bin/env node

/**
 * Validates all scene entries in registry/scenes/ against the JSON schema.
 * Checks: schema compliance, slug uniqueness, slug matches filename,
 * license required when audioBundled, and downloadUrl is reachable.
 *
 * Usage: node registry/scripts/validate.mjs [--check-urls]
 */

import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

const REGISTRY_DIR = resolve(import.meta.dirname, '..')
const SCENES_DIR = join(REGISTRY_DIR, 'scenes')
const SCHEMA_PATH = join(REGISTRY_DIR, 'schema', 'scene-entry.schema.json')

const checkUrls = process.argv.includes('--check-urls')
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

function validateEntry(filePath, schema) {
  const relative = filePath.replace(`${SCENES_DIR}/`, '')
  let data
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'))
  }
  catch (e) {
    errors.push(`${relative}: Invalid JSON — ${e.message}`)
    return null
  }

  // Check required fields
  for (const field of schema.required) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`${relative}: Missing required field "${field}"`)
    }
  }

  // Check no extra fields
  const allowed = new Set(Object.keys(schema.properties))
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      errors.push(`${relative}: Unknown field "${key}"`)
    }
  }

  // Slug pattern
  if (data.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) {
    errors.push(`${relative}: Slug "${data.slug}" must be lowercase alphanumeric with hyphens`)
  }

  // Slug matches filename
  const expectedSlug = basename(filePath, '.json')
  if (data.slug && data.slug !== expectedSlug) {
    errors.push(`${relative}: Slug "${data.slug}" does not match filename "${expectedSlug}.json"`)
  }

  // Version pattern
  if (data.version && !/^\d+\.\d+\.\d+$/.test(data.version)) {
    errors.push(`${relative}: Version "${data.version}" must be semver (e.g. 1.0.0)`)
  }

  // Tags non-empty
  if (Array.isArray(data.tags) && data.tags.length === 0) {
    errors.push(`${relative}: Tags array must have at least one entry`)
  }

  // Download URL must be HTTPS
  if (data.downloadUrl && !data.downloadUrl.startsWith('https://')) {
    errors.push(`${relative}: downloadUrl must use HTTPS`)
  }

  // audioBundled must be false — the registry only accepts reference-only scenes
  if (data.audioBundled !== false) {
    errors.push(`${relative}: "audioBundled" must be false — the registry does not accept scenes that bundle audio files`)
  }

  // Timestamps
  for (const field of ['createdAt', 'updatedAt']) {
    if (data[field] && Number.isNaN(Date.parse(data[field]))) {
      errors.push(`${relative}: "${field}" is not a valid ISO 8601 date`)
    }
  }

  return data
}

async function checkUrl(url, relative) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    if (!response.ok) {
      errors.push(`${relative}: downloadUrl returned HTTP ${response.status}`)
    }
  }
  catch (e) {
    errors.push(`${relative}: downloadUrl unreachable — ${e.message}`)
  }
}

// Main
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))

let jsonFiles
try {
  jsonFiles = collectJsonFiles(SCENES_DIR)
}
catch {
  jsonFiles = []
}

// Filter out .gitkeep and non-json
const sceneFiles = jsonFiles.filter(f => extname(f) === '.json')

if (sceneFiles.length === 0) {
  console.warn('No scene entries found in registry/scenes/ — nothing to validate.')
  process.exit(0)
}

// Validate all entries
const slugs = new Map()
const urlChecks = []

for (const file of sceneFiles) {
  const data = validateEntry(file, schema)
  if (!data)
    continue

  // Slug uniqueness
  const relative = file.replace(`${SCENES_DIR}/`, '')
  if (data.slug) {
    if (slugs.has(data.slug)) {
      errors.push(`${relative}: Duplicate slug "${data.slug}" (also in ${slugs.get(data.slug)})`)
    }
    else {
      slugs.set(data.slug, relative)
    }
  }

  // URL reachability (optional)
  if (checkUrls && data.downloadUrl) {
    urlChecks.push(checkUrl(data.downloadUrl, relative))
  }
}

if (urlChecks.length > 0) {
  await Promise.all(urlChecks)
}

// Report
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
