import type { Config } from '../config'
import type { SoundCategory } from '../sound/sound.types'
import type { SceneManifest, ScenePackageItem } from './scene-package.types'
import type { Scene, SceneItem } from './scene-store'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import AdmZip from 'adm-zip'
import { createLogger } from '../logger'
import { createSceneStore } from './scene-store'

const log = createLogger('scene-import')

const MANIFEST_JSON = 'hibiki-scene.json'
const SOUNDS_PREFIX = 'sounds/'

const CATEGORIES: SoundCategory[] = ['music', 'effects', 'ambience']

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

function extractBundledSounds(zip: AdmZip, config: Config): Map<string, string> {
  const bundledFileIds = new Map<string, string>()
  for (const category of CATEGORIES) {
    const prefix = `${SOUNDS_PREFIX}${category}/`
    const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName.startsWith(prefix))
    if (entries.length === 0)
      continue
    const destDir = resolveStorageDir(config, category)
    mkdirSync(destDir, { recursive: true })
    for (const entry of entries) {
      const filename = basename(entry.entryName)
      if (filename.startsWith('.'))
        continue
      writeFileSync(join(destDir, filename), entry.getData())
      const soundId = filename.replace(extname(filename), '')
      bundledFileIds.set(entry.entryName, soundId)
    }
  }
  return bundledFileIds
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
  const bundledFileIds = extractBundledSounds(zip, config)

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
    ambience: manifest.scene.ambience.map(pkg => manifestItemToSceneItem(pkg, bundledFileIds)),
    music: manifest.scene.music.map(pkg => manifestItemToSceneItem(pkg, bundledFileIds)),
    effects: manifest.scene.effects.map(pkg => manifestItemToSceneItem(pkg, bundledFileIds)),
  }
  const saved = await scenes.save(scene)
  log.info(`Imported "${saved.name}" (${saved.id})`)
  return saved
}
