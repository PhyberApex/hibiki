import type { Config } from '../config'
import type { SoundCategory } from '../sound/sound.types'
import type { SceneManifest, ScenePackageItem } from './scene-package.types'
import type { Scene, SceneItem } from './scene-store'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import AdmZip from 'adm-zip'
import slugify from 'slugify'
import { createLogger } from '../logger'
import { idFromFilename, isSafeSoundId, SOUND_CATEGORIES } from '../sound/sound-id'
import { countRepeatIntervals, createSceneStore, isRecord, normalizeMusicMode, uniqueSceneName } from './scene-store'

const log = createLogger('scene-import')

const MANIFEST_JSON = 'hibiki-scene.json'
const SOUNDS_PREFIX = 'sounds/'
/** A manifest is a few KB of JSON; anything near this is not one. */
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024

/**
 * Caps on the declared uncompressed size of bundled sounds. adm-zip inflates an
 * entry fully into memory but never past its declared size, so checking the
 * header before `getData()` bounds what a deflate bomb can allocate (#652).
 */
export interface SceneImportLimits {
  maxFileBytes: number
  maxTotalBytes: number
}

export const SCENE_IMPORT_LIMITS: SceneImportLimits = {
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
}

function validateItem(raw: unknown, where: string): string | null {
  if (!isRecord(raw))
    return `${where} must be an object`
  if (typeof raw.soundName !== 'string' || raw.soundName === '')
    return `${where} has no soundName`
  if (raw.volume !== undefined && !(typeof raw.volume === 'number' && Number.isFinite(raw.volume) && raw.volume >= 0 && raw.volume <= 100))
    return `${where} volume must be a number from 0 to 100`
  for (const key of ['enabled', 'loop', 'bundled']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean')
      return `${where} ${key} must be true or false`
  }
  for (const key of ['repeatMin', 'repeatMax']) {
    const value = raw[key]
    if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value) && value >= 0))
      return `${where} ${key} must be a number of seconds from 0`
  }
  if (typeof raw.repeatMin === 'number' && typeof raw.repeatMax === 'number' && raw.repeatMax < raw.repeatMin)
    return `${where} repeatMax must not be less than repeatMin`
  if (raw.bundledPath !== undefined && typeof raw.bundledPath !== 'string')
    return `${where} bundledPath must be a string`
  if (raw.source !== undefined && !(isRecord(raw.source) && typeof raw.source.name === 'string'))
    return `${where} source must have a name`
  return null
}

/** The first problem with a parsed `hibiki-scene.json`, or null when it has the shape `SceneManifest` declares. */
function findManifestProblem(manifest: unknown): string | null {
  if (!isRecord(manifest))
    return 'not an object'
  if (manifest.formatVersion !== 1)
    return `unsupported formatVersion ${JSON.stringify(manifest.formatVersion)}`
  if (!isRecord(manifest.scene))
    return 'missing scene data'
  for (const key of ['displayName', 'name']) {
    if (manifest[key] !== undefined && typeof manifest[key] !== 'string')
      return `${key} must be a string`
  }
  for (const category of SOUND_CATEGORIES) {
    const list = manifest.scene[category]
    if (!Array.isArray(list))
      return `scene.${category} must be a list`
    for (const [index, item] of list.entries()) {
      const problem = validateItem(item, `${category} item ${index + 1}`)
      if (problem)
        return problem
    }
  }
  return null
}

function parseManifest(raw: string, archiveName: string): SceneManifest {
  let manifest: unknown
  try {
    manifest = JSON.parse(raw)
  }
  catch (e) {
    log.warn(`Rejected archive ${archiveName}: hibiki-scene.json is not valid JSON`)
    throw e
  }
  const problem = findManifestProblem(manifest)
  if (problem) {
    log.warn(`Rejected archive ${archiveName}: ${problem}`)
    throw new Error(`Invalid hibiki-scene.json: ${problem}`)
  }
  return manifest as SceneManifest
}

function resolveStorageDir(config: Config, category: SoundCategory): string {
  return category === 'music'
    ? config.audio.musicDir
    : category === 'effects'
      ? config.audio.effectsDir
      : config.audio.ambienceDir
}

function manifestItemToSceneItem(
  pkg: ScenePackageItem,
  bundledFileIds: Map<string, string>,
): SceneItem {
  const soundId = pkg.bundled && pkg.bundledPath
    ? (bundledFileIds.get(pkg.bundledPath) ?? pkg.soundName)
    : pkg.soundName
  const item: SceneItem = {
    soundId,
    soundName: pkg.soundName,
    volume: pkg.volume,
  }
  if (pkg.enabled !== undefined)
    item.enabled = pkg.enabled
  if (pkg.loop !== undefined)
    item.loop = pkg.loop
  if (pkg.repeatMin !== undefined)
    item.repeatMin = pkg.repeatMin
  if (pkg.repeatMax !== undefined)
    item.repeatMax = pkg.repeatMax
  if (pkg.source)
    item.source = pkg.source
  return item
}

interface BundledSound {
  entry: AdmZip.IZipEntry
  destDir: string
  filename: string
  soundId: string
  /** An identical-looking file (same name and size) already in the library: nothing to write. */
  reuse: boolean
}

/**
 * Ids already in a library folder, keyed lower-cased because Windows and macOS
 * folders are case-insensitive, with each file's size.
 */
function readLibrary(destDir: string): Map<string, { filename: string, size: number }[]> {
  const byId = new Map<string, { filename: string, size: number }[]>()
  let filenames: string[]
  try {
    filenames = readdirSync(destDir)
  }
  catch {
    return byId
  }
  for (const filename of filenames) {
    let size: number
    try {
      size = statSync(join(destDir, filename)).size
    }
    catch {
      continue
    }
    const id = idFromFilename(filename).toLowerCase()
    byId.set(id, [
      ...(byId.get(id) ?? []),
      { filename, size },
    ])
  }
  return byId
}

/** A `<slug>-<Date.now()>` id, like the Sound Library gives an upload, free in `taken`. */
function freshSoundId(soundId: string, taken: (id: string) => boolean): string {
  const slug = slugify(soundId, { lower: true, strict: true }) || 'sound'
  let stamp = Date.now()
  while (taken(`${slug}-${stamp}`))
    stamp++
  return `${slug}-${stamp}`
}

function assertWithinLimits(entry: AdmZip.IZipEntry, total: number, limits: SceneImportLimits, archiveName: string): void {
  const size = entry.header.size
  if (size > limits.maxFileBytes) {
    log.warn(`Rejected archive ${archiveName}: ${entry.entryName} declares ${size} bytes, over the ${limits.maxFileBytes}-byte limit`)
    throw new Error(`Invalid scene archive: ${entry.entryName} (${size} bytes) exceeds the ${limits.maxFileBytes}-byte limit per sound`)
  }
  if (total > limits.maxTotalBytes) {
    log.warn(`Rejected archive ${archiveName}: bundled sounds declare ${total} bytes, over the ${limits.maxTotalBytes}-byte limit`)
    throw new Error(`Invalid scene archive: bundled sounds (${total} bytes) exceed the ${limits.maxTotalBytes}-byte limit`)
  }
}

/**
 * Decides where each bundled sound goes without touching the disk. A sound
 * never replaces a library file: the same name and size is taken to be that
 * file and reused, any other clash on the id gets a fresh id (#652).
 */
function planBundledSounds(zip: AdmZip, config: Config, limits: SceneImportLimits, archiveName: string): BundledSound[] {
  const planned: BundledSound[] = []
  let total = 0
  for (const category of SOUND_CATEGORIES) {
    const prefix = `${SOUNDS_PREFIX}${category}/`
    const destDir = resolveStorageDir(config, category)
    const library = readLibrary(destDir)
    const plannedIds = new Set<string>()
    const taken = (id: string) => library.has(id.toLowerCase()) || plannedIds.has(id.toLowerCase())
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith(prefix))
        continue
      const filename = basename(entry.entryName)
      if (filename.startsWith('.'))
        continue
      total += entry.header.size
      assertWithinLimits(entry, total, limits, archiveName)
      const soundId = idFromFilename(filename)
      const sameFile = library.get(soundId.toLowerCase())?.find(f => f.filename === filename && f.size === entry.header.size)
      if (sameFile && !plannedIds.has(soundId.toLowerCase())) {
        plannedIds.add(soundId.toLowerCase())
        planned.push({
          entry,
          destDir,
          filename,
          soundId,
          reuse: true,
        })
        continue
      }
      if (!taken(soundId)) {
        plannedIds.add(soundId.toLowerCase())
        planned.push({
          entry,
          destDir,
          filename,
          soundId,
          reuse: false,
        })
        continue
      }
      const renamed = freshSoundId(soundId, taken)
      plannedIds.add(renamed.toLowerCase())
      planned.push({
        entry,
        destDir,
        filename: `${renamed}${extname(filename)}`,
        soundId: renamed,
        reuse: false,
      })
    }
  }
  return planned
}

/** Writes the planned sounds, recording each one in `written` as it lands so a rollback removes only those. */
function writeBundledSounds(planned: BundledSound[], written: BundledSound[]): void {
  for (const sound of planned) {
    const { entry, destDir, filename, soundId, reuse } = sound
    const original = basename(entry.entryName)
    if (reuse) {
      log.info(`Reusing library file ${join(destDir, filename)} for ${entry.entryName} (same name and size)`)
      continue
    }
    mkdirSync(destDir, { recursive: true })
    // 'wx': a file that appeared since planning is never replaced
    writeFileSync(join(destDir, filename), entry.getData(), { flag: 'wx' })
    written.push(sound)
    if (filename === original)
      log.info(`Extracted ${entry.entryName} to ${join(destDir, filename)}`)
    else
      log.info(`Extracted ${entry.entryName} to ${join(destDir, filename)} as ${soundId}: ${idFromFilename(original)} is already in the library`)
  }
}

/** Undoes `writeBundledSounds` when the Scene itself is not saved, so a failed import leaves no orphan files. */
function removeWrittenSounds(written: BundledSound[]): void {
  for (const { destDir, filename } of written) {
    try {
      rmSync(join(destDir, filename), { force: true })
      log.info(`Removed ${join(destDir, filename)}: the imported Scene was not saved`)
    }
    catch (e) {
      log.warn(`Could not remove ${join(destDir, filename)} after a failed import:`, e)
    }
  }
}

/** A Scene item's sound id is later globbed inside a category folder, so it must be one safe path segment (#637). */
function assertSafeSoundIds(items: SceneItem[], category: SoundCategory, archiveName: string): void {
  for (const item of items) {
    if (isSafeSoundId(item.soundId))
      continue
    log.warn(`Rejected archive ${archiveName}: ${category} item has unsafe sound id ${JSON.stringify(item.soundId)}`)
    throw new Error(`Invalid hibiki-scene.json: ${category} item '${String(item.soundId)}' is not a valid sound id`)
  }
}

export async function importScene(config: Config, sourceZipPath: string, limits: SceneImportLimits = SCENE_IMPORT_LIMITS): Promise<Scene> {
  log.info(`Importing from ${sourceZipPath}`)
  const archiveName = basename(sourceZipPath)
  const zip = new AdmZip(sourceZipPath)

  const manifestEntry = zip.getEntry(MANIFEST_JSON)
  if (!manifestEntry) {
    log.warn(`Rejected archive ${archiveName}: missing hibiki-scene.json`)
    throw new Error('Invalid scene archive: missing hibiki-scene.json')
  }
  if (manifestEntry.header.size > MAX_MANIFEST_BYTES) {
    log.warn(`Rejected archive ${archiveName}: hibiki-scene.json declares ${manifestEntry.header.size} bytes`)
    throw new Error(`Invalid scene archive: hibiki-scene.json exceeds the ${MAX_MANIFEST_BYTES}-byte limit`)
  }

  const manifest = parseManifest(manifestEntry.getData().toString('utf-8'), archiveName)

  const scenes = createSceneStore(config)
  const bundled = planBundledSounds(zip, config, limits, archiveName)
  const bundledFileIds = new Map(bundled.map(b => [b.entry.entryName, b.soundId]))
  const items = {} as Record<SoundCategory, SceneItem[]>
  for (const category of SOUND_CATEGORIES) {
    items[category] = manifest.scene[category].map(pkg => manifestItemToSceneItem(pkg, bundledFileIds))
    assertSafeSoundIds(items[category], category, archiveName)
  }
  const name = uniqueSceneName(
    [manifest.displayName, manifest.name].find(n => n?.trim()) ?? 'Imported scene',
    await scenes.list(),
  )
  const scene: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> = {
    name,
    ...items,
    musicMode: normalizeMusicMode(manifest.scene.musicMode),
  }
  let saved: Scene
  const written: BundledSound[] = []
  try {
    writeBundledSounds(bundled, written)
    saved = await scenes.save(scene)
  }
  catch (e) {
    removeWrittenSounds(written)
    throw e
  }
  log.info(`Imported "${saved.name}" (${saved.id}); ${countRepeatIntervals(saved)} item(s) carry a repeat interval`)
  return saved
}
