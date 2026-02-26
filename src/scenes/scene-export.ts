import type { Config } from '../config'
import type { SoundCategory } from '../sound/sound.types'
import type { Scene, SceneItem } from './scene-store'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import AdmZip from 'adm-zip'
import { createLogger } from '../logger'
import { createSoundLibrary } from '../sound/sound-library'
import { createSceneStore } from './scene-store'

const log = createLogger('scene-export')

const SCENE_JSON = 'scene.json'
const SOUNDS_DIR = 'sounds'

function collectSoundIds(scene: Scene): { category: SoundCategory, soundId: string }[] {
  const items: { category: SoundCategory, soundId: string }[] = []
  const add = (cat: SoundCategory, list: SceneItem[]) => {
    for (const item of list) {
      if (item.soundId)
        items.push({ category: cat, soundId: item.soundId })
    }
  }
  add('ambience', scene.ambience)
  add('music', scene.music)
  add('effects', scene.effects)
  return items
}

function dedupe<T>(items: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((x) => {
    const k = key(x)
    if (seen.has(k))
      return false
    seen.add(k)
    return true
  })
}

export async function exportScene(
  config: Config,
  sceneId: string,
  targetZipPath: string,
): Promise<void> {
  const scenes = createSceneStore(config)
  const sounds = createSoundLibrary(config)
  const scene = await scenes.get(sceneId)
  if (!scene)
    throw new Error(`Scene '${sceneId}' not found`)

  log.info(`Exporting "${scene.name}" (${sceneId})`)
  const zip = new AdmZip()
  zip.addFile(SCENE_JSON, Buffer.from(JSON.stringify(scene, null, 2), 'utf-8'))

  const soundRefs = dedupe(collectSoundIds(scene), x => `${x.category}:${x.soundId}`)
  for (const { category, soundId } of soundRefs) {
    try {
      const srcPath = await sounds.getFilePath(category, soundId)
      const filename = basename(srcPath)
      const entryPath = `${SOUNDS_DIR}/${category}/${filename}`
      zip.addFile(entryPath, readFileSync(srcPath))
    }
    catch (e) {
      log.warn(`Skipping missing sound ${category}/${soundId}:`, e)
    }
  }

  zip.writeZip(targetZipPath)
  log.info(`Written to ${targetZipPath}`)
}
