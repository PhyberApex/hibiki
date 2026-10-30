import type { Config } from '../config'
import type { SoundCategory } from '../sound/sound.types'
import type { SceneManifest, ScenePackageItem } from './scene-package.types'
import type { Scene, SceneItem } from './scene-store'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import AdmZip from 'adm-zip'
import { createLogger } from '../logger'
import { createSoundLibrary } from '../sound/sound-library'
import { countRepeatIntervals, createSceneStore, normalizeMusicMode } from './scene-store'

const log = createLogger('scene-export')

const MANIFEST_JSON = 'hibiki-scene.json'
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

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function toPackageItem(
  item: SceneItem,
  category: SoundCategory,
  bundledPaths: Map<string, string>,
): ScenePackageItem {
  const bundledPath = bundledPaths.get(`${category}:${item.soundId}`)
  const pkg: ScenePackageItem = {
    soundName: item.soundName ?? item.soundId,
    volume: item.volume,
    bundled: Boolean(bundledPath),
  }
  if (bundledPath)
    pkg.bundledPath = bundledPath
  if (item.enabled !== undefined)
    pkg.enabled = item.enabled
  if (item.loop !== undefined)
    pkg.loop = item.loop
  if (item.repeatMin !== undefined)
    pkg.repeatMin = item.repeatMin
  if (item.repeatMax !== undefined)
    pkg.repeatMax = item.repeatMax
  if (item.source)
    pkg.source = item.source
  return pkg
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

  const startedAt = Date.now()
  const zip = new AdmZip()

  const soundRefs = dedupe(collectSoundIds(scene), x => `${x.category}:${x.soundId}`)
  log.info(`Export started: "${scene.name}" (${sceneId}), Music Mode ${normalizeMusicMode(scene.musicMode)}, ${soundRefs.length} sound(s) to bundle`)
  let soundBytes = 0
  const bundledPaths = new Map<string, string>()
  for (const { category, soundId } of soundRefs) {
    try {
      const srcPath = await sounds.getFilePath(category, soundId)
      const filename = basename(srcPath)
      const entryPath = `${SOUNDS_DIR}/${category}/${filename}`
      // awaited per sound so the event loop gets a turn between files (#710)
      const data = await readFile(srcPath)
      zip.addFile(entryPath, data)
      soundBytes += data.length
      bundledPaths.set(`${category}:${soundId}`, entryPath)
    }
    catch (e) {
      log.warn(`Skipping missing sound ${category}/${soundId}:`, e)
    }
  }

  const manifest: SceneManifest = {
    formatVersion: 1,
    name: toSlug(scene.name),
    displayName: scene.name,
    description: '',
    author: '',
    version: '1.0.0',
    tags: [],
    category: 'environment',
    scene: {
      musicMode: normalizeMusicMode(scene.musicMode),
      music: scene.music.map(item => toPackageItem(item, 'music', bundledPaths)),
      ambience: scene.ambience.map(item => toPackageItem(item, 'ambience', bundledPaths)),
      effects: scene.effects.map(item => toPackageItem(item, 'effects', bundledPaths)),
    },
  }

  zip.addFile(MANIFEST_JSON, Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))

  // toBufferPromise deflates entry by entry on the zlib threadpool, where writeZip
  // would block (#710); fs/promises keeps the real error that writeZipPromise drops
  let archive: Buffer
  try {
    archive = await zip.toBufferPromise()
    await mkdir(dirname(targetZipPath), { recursive: true })
    await writeFile(targetZipPath, archive)
  }
  catch (e) {
    log.warn(`Export of "${scene.name}" (${sceneId}) failed after ${Date.now() - startedAt} ms`)
    throw e
  }
  log.info(`Export finished in ${Date.now() - startedAt} ms: ${bundledPaths.size} sound(s), ${soundBytes} bytes, ${archive.length}-byte archive written to ${targetZipPath}; ${countRepeatIntervals(scene)} item(s) carry a repeat interval`)
}
