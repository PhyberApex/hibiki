import type { Config } from '../config'
import type { SoundCategory } from '../sound/sound.types'
import type { SceneManifest, ScenePackageItem } from './scene-package.types'
import type { Scene, SceneItem } from './scene-store'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import AdmZip from 'adm-zip'
import slugify from 'slugify'
import { createLogger } from '../logger'
import { idFromFilename, isSafeSoundId, SOUND_CATEGORIES, SOUND_FILE_EXTENSIONS } from '../sound/sound-id'
import { countRepeatIntervals, createSceneStore, isRecord, normalizeMusicMode, uniqueSceneName } from './scene-store'

const log = createLogger('scene-import')

const MANIFEST_JSON = 'hibiki-scene.json'
const SOUNDS_PREFIX = 'sounds/'
/** A manifest is a few KB of JSON; anything near this is not one. */
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024

/** Below this declared size an entry is never judged by its compression ratio: a short silent clip may deflate well. */
const RATIO_FLOOR_BYTES = 1024 * 1024
/** Planning yields to the event loop after this many entries, so a large archive cannot starve the mixer (#710, #768). */
const PLAN_YIELD_EVERY = 64

/**
 * What a Scene package may hold. adm-zip inflates an entry fully into memory
 * but never past its declared size, so checking the header before `getData()`
 * bounds what a deflate bomb can allocate (#652); the counts, the archive size
 * and the compression ratio bound how long planning runs and how much disk a
 * small archive can fill (#768).
 */
export interface SceneImportLimits {
  /** Size of the `.zip` file itself, checked before it is read. */
  maxArchiveBytes: number
  /** Declared uncompressed size of one bundled sound. */
  maxFileBytes: number
  /** Declared uncompressed size of all bundled sounds together. */
  maxTotalBytes: number
  /** Entries of any kind, read from the end of the archive before adm-zip parses them. */
  maxArchiveEntries: number
  /** Bundled sound entries under `sounds/`. */
  maxBundledSounds: number
  /** Declared size over compressed size, per entry and for all bundled sounds together, above `RATIO_FLOOR_BYTES`. Audio barely deflates. */
  maxCompressionRatio: number
  /** Items in each of `scene.music`, `scene.ambience` and `scene.effects`. */
  maxItemsPerCategory: number
}

export const SCENE_IMPORT_LIMITS: SceneImportLimits = {
  maxArchiveBytes: 640 * 1024 * 1024,
  // an hour of 256 kbps audio is about 115 MB
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  // room for the bundled sounds plus directory entries and a zip tool's __MACOSX copies
  maxArchiveEntries: 2048,
  maxBundledSounds: 512,
  maxCompressionRatio: 200,
  maxItemsPerCategory: 512,
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
function findManifestProblem(manifest: unknown, limits: SceneImportLimits): string | null {
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
    if (list.length > limits.maxItemsPerCategory)
      return `scene.${category} has ${list.length} items, over the limit of ${limits.maxItemsPerCategory}`
    for (const [index, item] of list.entries()) {
      const problem = validateItem(item, `${category} item ${index + 1}`)
      if (problem)
        return problem
    }
  }
  return null
}

function parseManifest(raw: string, archiveName: string, limits: SceneImportLimits): SceneManifest {
  let manifest: unknown
  try {
    manifest = JSON.parse(raw)
  }
  catch (e) {
    log.warn(`Rejected archive ${archiveName}: hibiki-scene.json is not valid JSON`)
    throw e
  }
  const problem = findManifestProblem(manifest, limits)
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
async function readLibrary(destDir: string): Promise<Map<string, { filename: string, size: number }[]>> {
  const byId = new Map<string, { filename: string, size: number }[]>()
  let filenames: string[]
  try {
    filenames = await readdir(destDir)
  }
  catch {
    return byId
  }
  for (const filename of filenames) {
    let size: number
    try {
      size = (await stat(join(destDir, filename))).size
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

/**
 * Hands out `<slug>-<Date.now()>` ids, like the Sound Library gives an upload,
 * free in `taken`. Each slug resumes after the last stamp it handed out, so
 * many clashes on one slug do not rescan the stamps already used (#768).
 */
function createFreshSoundIds(taken: (id: string) => boolean): (soundId: string) => string {
  const nextStamp = new Map<string, number>()
  return (soundId) => {
    const slug = slugify(soundId, { lower: true, strict: true }) || 'sound'
    let stamp = nextStamp.get(slug) ?? Date.now()
    while (taken(`${slug}-${stamp}`))
      stamp++
    nextStamp.set(slug, stamp + 1)
    return `${slug}-${stamp}`
  }
}

/**
 * A stem an archive may keep as its library file name: letters, digits, `_`,
 * `-` and inner dots, the shape the Sound Library's own ids have. Anything else
 * (spaces, backslashes, trailing dots or spaces, control characters) is renamed.
 */
const KEEPABLE_STEM = /^[\w-](?:[\w.-]*[\w-])?$/
/** Names Windows reserves for devices, with or without an extension: `CON.mp3` is not a file there. */
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i

/** Whether a bundled file may keep its archive name: a keepable stem that is no Windows device name before its first dot. */
function canKeepFilename(stem: string): boolean {
  return KEEPABLE_STEM.test(stem) && !WINDOWS_DEVICE_NAME.test(stem.split('.')[0]!)
}

/** Bytes the bundled sounds planned so far declare, and how many they take in the archive. */
interface BundledTotals {
  declared: number
  compressed: number
}

function assertWithinLimits(entry: AdmZip.IZipEntry, totals: BundledTotals, limits: SceneImportLimits, archiveName: string): void {
  const size = entry.header.size
  if (size > limits.maxFileBytes) {
    log.warn(`Rejected archive ${archiveName}: ${entry.entryName} declares ${size} bytes, over the ${limits.maxFileBytes}-byte limit`)
    throw new Error(`Invalid scene archive: ${entry.entryName} (${size} bytes) exceeds the ${limits.maxFileBytes}-byte limit per sound`)
  }
  const compressed = entry.header.compressedSize
  if (size > RATIO_FLOOR_BYTES && size > compressed * limits.maxCompressionRatio) {
    log.warn(`Rejected archive ${archiveName}: ${entry.entryName} declares ${size} bytes from ${compressed} compressed, over the ${limits.maxCompressionRatio}:1 ratio limit`)
    throw new Error(`Invalid scene archive: ${entry.entryName} is compressed more than ${limits.maxCompressionRatio}:1, which no sound file is`)
  }
  const total = totals.declared
  if (total > limits.maxTotalBytes) {
    log.warn(`Rejected archive ${archiveName}: bundled sounds declare ${total} bytes, over the ${limits.maxTotalBytes}-byte limit`)
    throw new Error(`Invalid scene archive: bundled sounds (${total} bytes) exceed the ${limits.maxTotalBytes}-byte limit`)
  }
  // many entries each just under the floor must not add up to a bomb
  if (total > RATIO_FLOOR_BYTES && total > totals.compressed * limits.maxCompressionRatio) {
    log.warn(`Rejected archive ${archiveName}: bundled sounds declare ${total} bytes from ${totals.compressed} compressed, over the ${limits.maxCompressionRatio}:1 ratio limit`)
    throw new Error(`Invalid scene archive: bundled sounds are compressed more than ${limits.maxCompressionRatio}:1, which no sound files are`)
  }
}

/**
 * Decides where each bundled sound goes without touching the disk. A sound
 * never replaces a library file: the same name and size is taken to be that
 * file and reused, any other clash on the id gets a fresh id (#652).
 */
async function planBundledSounds(zip: AdmZip, config: Config, limits: SceneImportLimits, archiveName: string): Promise<BundledSound[]> {
  const entries = zip.getEntries().filter(entry => !entry.isDirectory && entry.entryName.startsWith(SOUNDS_PREFIX))
  if (entries.length > limits.maxBundledSounds) {
    log.warn(`Rejected archive ${archiveName}: ${entries.length} bundled sound entries, over the limit of ${limits.maxBundledSounds}`)
    throw new Error(`Invalid scene archive: ${entries.length} bundled sounds exceed the limit of ${limits.maxBundledSounds}`)
  }
  const planned: BundledSound[] = []
  const totals: BundledTotals = { declared: 0, compressed: 0 }
  let iterations = 0
  for (const category of SOUND_CATEGORIES) {
    const prefix = `${SOUNDS_PREFIX}${category}/`
    const destDir = resolveStorageDir(config, category)
    const library = await readLibrary(destDir)
    const plannedIds = new Set<string>()
    const taken = (id: string) => library.has(id.toLowerCase()) || plannedIds.has(id.toLowerCase())
    const freshSoundId = createFreshSoundIds(taken)
    for (const entry of entries) {
      if (++iterations % PLAN_YIELD_EVERY === 0)
        await new Promise(resolve => setImmediate(resolve))
      if (!entry.entryName.startsWith(prefix))
        continue
      const filename = basename(entry.entryName)
      if (filename.startsWith('.'))
        continue
      // Without an audio extension `findFilename`'s `<id>.*` never matches, so the file could never be deleted (#785).
      const ext = extname(filename).toLowerCase()
      if (!SOUND_FILE_EXTENSIONS.includes(ext)) {
        log.warn(`Skipped ${entry.entryName} in ${archiveName}: ${ext
          ? `${JSON.stringify(ext)} is not`
          : 'it has no'} sound file extension`)
        continue
      }
      totals.declared += entry.header.size
      totals.compressed += entry.header.compressedSize
      assertWithinLimits(entry, totals, limits, archiveName)
      const soundId = idFromFilename(filename)
      if (!canKeepFilename(soundId)) {
        const renamed = freshSoundId(soundId)
        plannedIds.add(renamed.toLowerCase())
        planned.push({
          entry,
          destDir,
          filename: `${renamed}${ext}`,
          soundId: renamed,
          reuse: false,
        })
        continue
      }
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
      const renamed = freshSoundId(soundId)
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

/**
 * Inflates one entry on the zlib threadpool and yields while it runs, so the
 * mixer keeps being fed (#710). adm-zip still checks the CRC on this thread.
 */
function readEntry(entry: AdmZip.IZipEntry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fail = (err: unknown) => reject(err instanceof Error
      ? err
      : new Error(`Could not read ${entry.entryName} from the archive: ${String(err)}`))
    try {
      entry.getDataAsync((data, err) => err
        ? fail(err)
        : resolve(data))
    }
    catch (e) {
      // a stored entry with a bad CRC reports through the callback and then throws as well
      fail(e)
    }
  })
}

/**
 * Writes the planned sounds one at a time, recording each one in `written` as
 * it lands so a rollback removes only those. Awaiting per file gives the event
 * loop a turn between sounds, so playback is not starved by a large import (#710).
 */
async function writeBundledSounds(planned: BundledSound[], written: BundledSound[]): Promise<void> {
  for (const sound of planned) {
    const { entry, destDir, filename, soundId, reuse } = sound
    const original = basename(entry.entryName)
    if (reuse) {
      log.info(`Reusing library file ${join(destDir, filename)} for ${entry.entryName} (same name and size)`)
      continue
    }
    const data = await readEntry(entry)
    await mkdir(destDir, { recursive: true })
    // 'wx': a file that appeared since planning is never replaced
    await writeFile(join(destDir, filename), data, { flag: 'wx' })
    written.push(sound)
    if (filename === original)
      log.info(`Extracted ${entry.entryName} to ${join(destDir, filename)}`)
    else if (canKeepFilename(idFromFilename(original)))
      log.info(`Extracted ${entry.entryName} to ${join(destDir, filename)} as ${soundId}: ${idFromFilename(original)} is already in the library`)
    else
      log.info(`Extracted ${entry.entryName} to ${join(destDir, filename)} as ${soundId}: its name is not one a library file may have`)
  }
}

/** Undoes `writeBundledSounds` when the Scene itself is not saved, so a failed import leaves no orphan files. */
async function removeWrittenSounds(written: BundledSound[]): Promise<void> {
  for (const { destDir, filename } of written) {
    try {
      await rm(join(destDir, filename), { force: true })
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

export async function importScene(config: Config, sourceZipPath: string, overrides: Partial<SceneImportLimits> = {}): Promise<Scene> {
  const limits = {
    ...SCENE_IMPORT_LIMITS,
    ...overrides,
  }
  log.info(`Importing from ${sourceZipPath}`)
  const startedAt = Date.now()
  const archiveName = basename(sourceZipPath)
  const archiveBytes = (await stat(sourceZipPath)).size
  if (archiveBytes > limits.maxArchiveBytes) {
    log.warn(`Rejected archive ${archiveName}: ${archiveBytes} bytes, over the ${limits.maxArchiveBytes}-byte limit`)
    throw new Error(`Invalid scene archive: the file (${archiveBytes} bytes) exceeds the ${limits.maxArchiveBytes}-byte limit`)
  }
  // adm-zip would read the archive with readFileSync; hand it the buffer instead (#710)
  // construction reads only the end-of-central-directory record (zip64 included);
  // the entries themselves are parsed synchronously on first access, so the count
  // adm-zip will parse is checked before anything touches them (#768)
  const zip = new AdmZip(await readFile(sourceZipPath))
  const entryCount = zip.getEntryCount()
  if (entryCount > limits.maxArchiveEntries) {
    log.warn(`Rejected archive ${archiveName}: declares ${entryCount} entries, over the limit of ${limits.maxArchiveEntries}`)
    throw new Error(`Invalid scene archive: ${entryCount} entries exceed the limit of ${limits.maxArchiveEntries}`)
  }

  const manifestEntry = zip.getEntry(MANIFEST_JSON)
  if (!manifestEntry) {
    log.warn(`Rejected archive ${archiveName}: missing hibiki-scene.json`)
    throw new Error('Invalid scene archive: missing hibiki-scene.json')
  }
  if (manifestEntry.header.size > MAX_MANIFEST_BYTES) {
    log.warn(`Rejected archive ${archiveName}: hibiki-scene.json declares ${manifestEntry.header.size} bytes`)
    throw new Error(`Invalid scene archive: hibiki-scene.json exceeds the ${MAX_MANIFEST_BYTES}-byte limit`)
  }

  const manifest = parseManifest((await readEntry(manifestEntry)).toString('utf-8'), archiveName, limits)

  const scenes = createSceneStore(config)
  const bundled = await planBundledSounds(zip, config, limits, archiveName)
  const toWrite = bundled.filter(b => !b.reuse)
  const bytesToWrite = toWrite.reduce((sum, b) => sum + b.entry.header.size, 0)
  log.info(`Import started (${toWrite.length} bundled file(s) to write, ${bytesToWrite} bytes; ${bundled.length - toWrite.length} reused)`)
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
    await writeBundledSounds(bundled, written)
    saved = await scenes.save(scene)
  }
  catch (e) {
    log.warn(`Import of ${archiveName} failed after ${Date.now() - startedAt} ms`)
    await removeWrittenSounds(written)
    throw e
  }
  log.info(`Import finished in ${Date.now() - startedAt} ms: "${saved.name}" (${saved.id}); ${countRepeatIntervals(saved)} item(s) carry a repeat interval`)
  return saved
}
