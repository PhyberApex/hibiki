import type { Config } from '../config'
import type { SoundCategory, SoundFile } from './sound.types'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import fg from 'fast-glob'
import slugify from 'slugify'

function resolvePath(config: Config, category: SoundCategory, filename?: string): string {
  const base = category === 'music'
    ? config.audio.musicDir
    : category === 'effects'
      ? config.audio.effectsDir
      : config.audio.ambienceDir
  return filename ? join(base, filename) : base
}

function humanize(filename: string): string {
  return filename
    .replace(extname(filename), '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function escapeGlob(id: string): string {
  return id.replace(/[*?[\](){}!\\]/g, '\\$&')
}

async function findFilename(config: Config, category: SoundCategory, id: string): Promise<string> {
  const base = resolvePath(config, category)
  const escaped = escapeGlob(id)
  const matches = await fg(`${escaped}.*`, { cwd: base, onlyFiles: true, dot: false })
  if (!matches.length)
    throw new Error(`Sound '${id}' not found in ${category}`)
  return matches[0]
}

function buildId(name: string): string {
  return `${slugify(name.replace(extname(name), ''), { lower: true, strict: true })}-${Date.now()}`
}

export function createSoundLibrary(config: Config) {
  return {
    async list(category: SoundCategory): Promise<SoundFile[]> {
      const base = resolvePath(config, category)
      let entries: string[]
      try {
        entries = await fg('*', { cwd: base, onlyFiles: true })
      }
      catch {
        return []
      }
      const results: SoundFile[] = []
      for (const file of entries) {
        const filePath = resolvePath(config, category, file)
        try {
          const stats = await stat(filePath)
          results.push({
            id: file.replace(extname(file), ''),
            name: humanize(file),
            filename: file,
            size: stats.size,
            category,
            createdAt: stats.birthtime.toISOString(),
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

    async getFile(category: SoundCategory, id: string): Promise<SoundFile & { path: string }> {
      const filename = await findFilename(config, category, id)
      const path = resolvePath(config, category, filename)
      const stats = await stat(path)
      return {
        id,
        name: humanize(filename),
        filename,
        category,
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
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
    },

    async save(
      category: SoundCategory,
      file: { buffer: Buffer, originalname: string },
    ): Promise<SoundFile> {
      const base = category === 'music'
        ? config.audio.musicDir
        : category === 'effects'
          ? config.audio.effectsDir
          : config.audio.ambienceDir
      await mkdir(base, { recursive: true })
      const safeId = buildId(file.originalname)
      const ext = extname(file.originalname) || '.mp3'
      const filename = `${safeId}${ext}`
      const target = join(base, filename)
      await writeFile(target, file.buffer)
      const stats = await stat(target)
      return {
        id: safeId,
        name: humanize(filename),
        filename,
        category,
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
      }
    },
  }
}

export type SoundLibrary = ReturnType<typeof createSoundLibrary>
