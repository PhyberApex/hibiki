import type { Config } from '../config'
import type { SoundCategory, SoundFile } from './sound.types'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import fg from 'fast-glob'
import slugify from 'slugify'
import { canDecode as canDecodeFile } from '../audio/decoders'
import { createLogger } from '../logger'
import { idFromFilename, isSafeSoundId, isSoundCategory } from './sound-id'
import { createSoundTagsStore } from './sound-tags.store'

const log = createLogger('sounds')

const CATEGORY_DIRS = {
  music: 'musicDir',
  effects: 'effectsDir',
  ambience: 'ambienceDir',
} as const satisfies Record<SoundCategory, keyof Config['audio']>

function resolvePath(config: Config, category: SoundCategory, filename?: string): string {
  if (!isSoundCategory(category)) {
    log.warn(`Rejected unknown sound category ${JSON.stringify(category)}`)
    throw new Error(`Invalid sound category '${String(category)}'`)
  }
  const base = config.audio[CATEGORY_DIRS[category]]
  if (!filename)
    return base
  const filePath = join(base, filename)
  if (!resolve(filePath).startsWith(resolve(base) + sep)) {
    log.warn(`Rejected ${category} file ${JSON.stringify(filename)}: resolves outside ${base}`)
    throw new Error(`Invalid sound file '${filename}'`)
  }
  return filePath
}

function humanize(filename: string): string {
  return idFromFilename(filename)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function escapeGlob(id: string): string {
  return id.replace(/[*?[\](){}!\\]/g, '\\$&')
}

async function findFilename(config: Config, category: SoundCategory, id: string): Promise<string> {
  const base = resolvePath(config, category)
  if (!isSafeSoundId(id)) {
    log.warn(`Rejected ${category} sound id ${JSON.stringify(id)}: not a single path segment`)
    throw new Error(`Invalid sound id '${String(id)}'`)
  }
  const escaped = escapeGlob(id)
  // `rain.*` also matches `rain.wav-mix.wav`, whose id is `rain.wav-mix`
  const match = (await fg(`${escaped}.*`, { cwd: base, onlyFiles: true, dot: false }))
    .find(filename => idFromFilename(filename) === id)
  if (!match)
    throw new Error(`Sound '${id}' not found in ${category}`)
  return match
}

function buildId(name: string): string {
  return `${slugify(idFromFilename(name), { lower: true, strict: true })}-${Date.now()}`
}

export function createSoundLibrary(config: Config) {
  const tagsStore = createSoundTagsStore(config)

  return {
    async list(category: SoundCategory): Promise<SoundFile[]> {
      const base = resolvePath(config, category)
      let entries: string[]
      try {
        entries = await fg('*', { cwd: base, onlyFiles: true })
      }
      catch (err) {
        log.warn(`Could not list ${category} in ${base}:`, err)
        return []
      }
      const tagsById = await tagsStore.getAll(category)
      const results: SoundFile[] = []
      for (const file of entries) {
        const filePath = resolvePath(config, category, file)
        try {
          const stats = await stat(filePath)
          const id = idFromFilename(file)
          if (id === file)
            log.warn(`${category} file ${JSON.stringify(file)} has no extension, so its id cannot be resolved back to it`)
          results.push({
            id,
            name: humanize(file),
            filename: file,
            size: stats.size,
            category,
            createdAt: stats.birthtime.toISOString(),
            tags: tagsById.get(id) ?? [],
          })
        }
        catch {
          continue
        }
      }
      return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async getFilePath(category: SoundCategory, id: string): Promise<string> {
      const filename = await findFilename(config, category, id)
      return resolvePath(config, category, filename)
    },

    /** Whether backend (Discord) playback can decode this file directly, vs. the renderer fallback. See ADR-0003. */
    async canDecode(category: SoundCategory, id: string): Promise<boolean> {
      const filename = await findFilename(config, category, id)
      return canDecodeFile(resolvePath(config, category, filename))
    },

    async getFile(category: SoundCategory, id: string): Promise<SoundFile & { path: string }> {
      const filename = await findFilename(config, category, id)
      const path = resolvePath(config, category, filename)
      const [stats, tags] = await Promise.all([
        stat(path),
        tagsStore.get(category, id),
      ])
      return {
        id,
        name: humanize(filename),
        filename,
        category,
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
        tags,
        path,
      }
    },

    async getFileByIdOrName(category: SoundCategory, idOrName: string): Promise<SoundFile & { path: string }> {
      try {
        return await this.getFile(category, idOrName)
      }
      catch {
        // ID lookup failed; fall through to name-based search
      }
      const list = await this.list(category)
      const lower = idOrName.toLowerCase()
      const match = list.find(
        f => f.id.toLowerCase() === lower || f.name.toLowerCase().includes(lower),
      )
      if (!match)
        throw new Error(`No ${category} found matching '${idOrName}'`)
      return this.getFile(category, match.id)
    },

    async remove(category: SoundCategory, id: string): Promise<void> {
      const file = await findFilename(config, category, id)
      const path = resolvePath(config, category, file)
      await unlink(path)
      await tagsStore.remove(category, id)
      log.info(`Deleted ${category} "${file}"`)
    },

    async setTags(category: SoundCategory, id: string, tags: string[]): Promise<string[]> {
      await findFilename(config, category, id)
      log.debug(`Tags for ${category}/${id} set to ${tags.length} tag(s)`)
      return tagsStore.set(category, id, tags)
    },

    async save(
      category: SoundCategory,
      file: { buffer: Buffer, originalname: string },
    ): Promise<SoundFile> {
      const base = resolvePath(config, category)
      await mkdir(base, { recursive: true })
      const safeId = buildId(file.originalname)
      const ext = extname(file.originalname) || '.mp3'
      const filename = `${safeId}${ext}`
      const target = join(base, filename)
      await writeFile(target, file.buffer)
      const stats = await stat(target)
      log.info(`Saved ${category} "${filename}" (${stats.size} bytes) from "${file.originalname}"`)
      return {
        id: safeId,
        name: humanize(filename),
        filename,
        category,
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
        tags: [],
      }
    },
  }
}

export type SoundLibrary = ReturnType<typeof createSoundLibrary>
