import type { Config } from '../config'
import type { SoundCategory } from '../sound/sound.types'
import type { SceneManifest, ScenePackageItem } from './scene-package.types'
import type { Scene, SceneItem } from './scene-store'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import AdmZip from 'adm-zip'
import { createLogger } from '../logger'
import { isSafeSoundId, SOUND_CATEGORIES } from '../sound/sound-id'
import { createSceneStore, normalizeMusicMode } from './scene-store'

const log = createLogger('scene-import')

const MANIFEST_JSON = 'hibiki-scene.json'
const SOUNDS_PREFIX = 'sounds/'

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
  if (pkg.source)
    item.source = pkg.source
  return item
}

interface BundledSound {
  entry: AdmZip.IZipEntry
  destDir: string
  filename: string
  soundId: string
}

function planBundledSounds(zip: AdmZip, config: Config): BundledSound[] {
  const planned: BundledSound[] = []
  for (const category of SOUND_CATEGORIES) {
    const prefix = `${SOUNDS_PREFIX}${category}/`
    const destDir = resolveStorageDir(config, category)
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith(prefix))
        continue
      const filename = basename(entry.entryName)
      if (filename.startsWith('.'))
        continue
      planned.push({
        entry,
        destDir,
        filename,
        soundId: filename.replace(extname(filename), ''),
      })
    }
  }
  return planned
}

function writeBundledSounds(planned: BundledSound[]): void {
  for (const { entry, destDir, filename } of planned) {
    mkdirSync(destDir, { recursive: true })
    writeFileSync(join(destDir, filename), entry.getData())
  }
}

/** A Scene item's sound id is later globbed inside a category folder, so it must be one safe path segment (#637). */
function assertSafeSoundIds(items: SceneItem[], category: SoundCategory): void {
  for (const item of items) {
    if (isSafeSoundId(item.soundId))
      continue
    log.warn(`Rejected archive: ${category} item has unsafe sound id ${JSON.stringify(item.soundId)}`)
    throw new Error(`Invalid hibiki-scene.json: ${category} item '${String(item.soundId)}' is not a valid sound id`)
  }
}

export async function importScene(config: Config, sourceZipPath: string): Promise<Scene> {
  log.info(`Importing from ${sourceZipPath}`)
  const zip = new AdmZip(sourceZipPath)

  const manifestEntry = zip.getEntry(MANIFEST_JSON)
  if (!manifestEntry)
    throw new Error('Invalid scene archive: missing hibiki-scene.json')

  const raw = manifestEntry.getData().toString('utf-8')
  const manifest = JSON.parse(raw) as SceneManifest
  if (!manifest.scene)
    throw new Error('Invalid hibiki-scene.json: missing scene data')

  const scenes = createSceneStore(config)
  const bundled = planBundledSounds(zip, config)
  const bundledFileIds = new Map(bundled.map(b => [b.entry.entryName, b.soundId]))
  const items = {} as Record<SoundCategory, SceneItem[]>
  for (const category of SOUND_CATEGORIES) {
    items[category] = manifest.scene[category].map(pkg => manifestItemToSceneItem(pkg, bundledFileIds))
    assertSafeSoundIds(items[category], category)
  }
  writeBundledSounds(bundled)

  const existing = await scenes.list()
  const existingNames = new Set(existing.map(s => s.name.toLowerCase()))
  let name = manifest.displayName || manifest.name
  if (!name)
    name = 'Imported scene'
  while (existingNames.has(name.toLowerCase())) {
    name = `${name} (imported)`
  }

  const scene: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> = {
    name,
    ...items,
    musicMode: normalizeMusicMode(manifest.scene.musicMode),
  }
  const saved = await scenes.save(scene)
  log.info(`Imported "${saved.name}" (${saved.id})`)
  return saved
}
