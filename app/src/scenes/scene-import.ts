import type { Config } from '../config'
import type { SoundCategory } from '../sound/sound.types'
import type { Scene } from './scene-store'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import AdmZip from 'adm-zip'
import { createLogger } from '../logger'
import { createSceneStore } from './scene-store'

const log = createLogger('scene-import')

const SCENE_JSON = 'scene.json'
const SOUNDS_PREFIX = 'sounds/'

const CATEGORIES: SoundCategory[] = ['music', 'effects', 'ambience']

function resolveStorageDir(config: Config, category: SoundCategory): string {
  return category === 'music'
    ? config.audio.musicDir
    : category === 'effects'
      ? config.audio.effectsDir
      : config.audio.ambienceDir
}

export async function importScene(config: Config, sourceZipPath: string): Promise<Scene> {
  log.info(`Importing from ${sourceZipPath}`)
  const zip = new AdmZip(sourceZipPath)

  const sceneEntry = zip.getEntry(SCENE_JSON)
  if (!sceneEntry)
    throw new Error('Invalid scene archive: missing scene.json')

  const raw = sceneEntry.getData().toString('utf-8')
  const data = JSON.parse(raw)
  if (!data || typeof data.name !== 'string')
    throw new Error('Invalid scene.json: missing name')

  const scenes = createSceneStore(config)
  const existing = await scenes.list()
  const existingNames = new Set(existing.map(s => s.name.toLowerCase()))
  let name = String(data.name).trim()
  if (!name)
    name = 'Imported scene'
  while (existingNames.has(name.toLowerCase())) {
    name = `${name} (imported)`
  }

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
    }
  }

  const scene: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> = {
    name,
    ambience: Array.isArray(data.ambience) ? data.ambience : [],
    music: Array.isArray(data.music) ? data.music : [],
    effects: Array.isArray(data.effects) ? data.effects : [],
  }
  const saved = await scenes.save(scene)
  log.info(`Imported "${saved.name}" (${saved.id})`)
  return saved
}
