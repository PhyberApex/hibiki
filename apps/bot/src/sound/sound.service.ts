import type { OnModuleInit } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { SoundTagService } from '../persistence/sound-tag.service'
import type { SoundCategory, SoundFile } from './sound.types'
import { createReadStream } from 'node:fs'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import fg from 'fast-glob'
import slugify from 'slugify'

@Injectable()
export class SoundLibraryService implements OnModuleInit {
  private readonly logger = new Logger(SoundLibraryService.name)
  private readonly musicDir: string
  private readonly effectsDir: string

  constructor(
    private readonly configService: ConfigService,
    private readonly soundTags: SoundTagService,
  ) {
    this.musicDir = this.configService.get<string>(
      'audio.musicDir',
      'storage/music',
    )
    this.effectsDir = this.configService.get<string>(
      'audio.effectsDir',
      'storage/effects',
    )
  }

  async onModuleInit() {
    await this.ensureDirectories()
  }

  private async ensureDirectories() {
    await mkdir(this.musicDir, { recursive: true })
    await mkdir(this.effectsDir, { recursive: true })
  }

  private resolvePath(category: SoundCategory, filename?: string) {
    const base = category === 'music' ? this.musicDir : this.effectsDir
    return filename ? join(base, filename) : base
  }

  async list(category: SoundCategory, tagFilter?: string): Promise<SoundFile[]> {
    const base = this.resolvePath(category)
    const entries = await fg('*', { cwd: base, onlyFiles: true })
    const results: SoundFile[] = []
    for (const file of entries) {
      const filePath = this.resolvePath(category, file)
      try {
        const stats = await stat(filePath)
        results.push({
          id: file.replace(extname(file), ''),
          name: this.humanize(file),
          filename: file,
          size: stats.size,
          category,
          createdAt: stats.birthtime.toISOString(),
        })
      }
      catch {
        this.logger.warn(`Skipping missing file: ${filePath}`)
      }
    }
    const soundIds = results.map(r => r.id)
    const tagsMap = await this.soundTags.getTagsBySoundIds(category, soundIds)
    for (const item of results) {
      item.tags = tagsMap.get(item.id) ?? []
    }
    let filtered = results
    if (tagFilter?.trim()) {
      const allowedIds = await this.soundTags.getSoundIdsWithTag(
        category,
        tagFilter.trim().toLowerCase(),
      )
      filtered = results.filter(r => allowedIds.has(r.id))
      this.logger.debug(`List ${category} tag=${tagFilter}: ${filtered.length} of ${results.length} items`)
    }
    else {
      this.logger.debug(`List ${category}: ${results.length} items`)
    }
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async setTags(category: SoundCategory, soundId: string, tags: string[]): Promise<void> {
    await this.findFilename(category, soundId)
    await this.soundTags.setTags(category, soundId, tags)
    this.logger.log(`Set tags for ${category}/${soundId}: [${tags.join(', ')}]`)
  }

  async getDistinctTags(category: SoundCategory): Promise<string[]> {
    return this.soundTags.getDistinctTags(category)
  }

  /** Stream the file for playback or download. */
  async getStream(
    category: SoundCategory,
    id: string,
  ): Promise<{ stream: ReturnType<typeof createReadStream>, filename: string }> {
    const filename = await this.findFilename(category, id)
    const path = this.resolvePath(category, filename)
    this.logger.debug(`Stream ${category}/${id} -> ${filename}`)
    const stream = createReadStream(path)
    return { stream, filename }
  }

  async getFile(
    category: SoundCategory,
    id: string,
  ): Promise<SoundFile & { path: string }> {
    const filename = await this.findFilename(category, id)
    const path = this.resolvePath(category, filename)
    const stats = await stat(path)
    return {
      id,
      name: this.humanize(filename),
      filename,
      category,
      size: stats.size,
      createdAt: stats.birthtime.toISOString(),
      path,
    }
  }

  /** Exact id first; else case-insensitive match on id or name. */
  async getFileByIdOrName(
    category: SoundCategory,
    idOrName: string,
  ): Promise<SoundFile & { path: string }> {
    try {
      return await this.getFile(category, idOrName)
    }
    catch {
      // not an exact id; try name match below
    }
    const list = await this.list(category)
    const lower = idOrName.toLowerCase()
    const match = list.find(
      f =>
        f.id.toLowerCase() === lower
        || f.name.toLowerCase().includes(lower),
    )
    if (!match) {
      throw new NotFoundException(
        `No ${category} found matching '${idOrName}'`,
      )
    }
    return this.getFile(category, match.id)
  }

  private async findFilename(
    category: SoundCategory,
    id: string,
  ): Promise<string> {
    const base = this.resolvePath(category)
    const matches = await fg(`${id}.*`, {
      cwd: base,
      onlyFiles: true,
      dot: false,
    })
    if (!matches.length) {
      throw new NotFoundException(`Sound '${id}' not found in ${category}`)
    }
    return matches[0]
  }

  async remove(category: SoundCategory, id: string): Promise<void> {
    const file = await this.findFilename(category, id)
    const path = this.resolvePath(category, file)
    await unlink(path)
    await this.soundTags.setTags(category, id, [])
    this.logger.log(`Removed ${category}/${id} (${file})`)
  }

  async save(
    category: SoundCategory,
    file: Express.Multer.File,
  ): Promise<SoundFile> {
    const safeId = this.buildId(file.originalname)
    const ext = extname(file.originalname) || '.mp3'
    const filename = `${safeId}${ext}`
    const target = this.resolvePath(category, filename)
    await writeFile(target, file.buffer)
    this.logger.log(`Saved ${category} asset ${filename}`)
    const stats = await stat(target)
    return {
      id: safeId,
      name: this.humanize(filename),
      filename,
      category,
      size: stats.size,
      createdAt: stats.birthtime.toISOString(),
    }
  }

  private buildId(name: string) {
    return (
      `${slugify(name.replace(extname(name), ''), { lower: true, strict: true })
      }-${
        Date.now()}`
    )
  }

  private humanize(filename: string) {
    return filename
      .replace(extname(filename), '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }
}
