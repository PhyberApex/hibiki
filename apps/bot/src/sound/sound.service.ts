import type { OnModuleInit } from '@nestjs/common'
import type { SoundCategory, SoundFile } from './sound.types'
import { createReadStream } from 'node:fs'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config' // eslint-disable-line ts/consistent-type-imports
import fg from 'fast-glob'
import slugify from 'slugify'
import { SoundDisplayNameService } from '../persistence/sound-display-name.service' // eslint-disable-line ts/consistent-type-imports
import { SoundTagService } from '../persistence/sound-tag.service' // eslint-disable-line ts/consistent-type-imports

@Injectable()
export class SoundLibraryService implements OnModuleInit {
  private readonly logger = new Logger(SoundLibraryService.name)
  private readonly musicDir: string
  private readonly effectsDir: string

  constructor(
    private readonly configService: ConfigService,
    private readonly soundTags: SoundTagService,
    private readonly soundDisplayNames: SoundDisplayNameService,
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
    const [tagsMap, displayNamesMap] = await Promise.all([
      this.soundTags.getTagsBySoundIds(category, soundIds),
      this.soundDisplayNames.getDisplayNamesBySoundIds(category, soundIds),
    ])
    for (const item of results) {
      item.tags = tagsMap.get(item.id) ?? []
      const customName = displayNamesMap.get(item.id)
      if (customName != null)
        item.name = customName
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

  async setDisplayName(
    category: SoundCategory,
    soundId: string,
    displayName: string,
  ): Promise<string> {
    const filename = await this.findFilename(category, soundId)
    const trimmed = displayName.trim()
    await this.soundDisplayNames.setDisplayName(category, soundId, trimmed)
    this.logger.log(`Set display name for ${category}/${soundId}: ${trimmed || '(clear)'}`)
    return trimmed || this.humanize(filename)
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
    const customName = await this.soundDisplayNames.getDisplayName(category, id)
    return {
      id,
      name: customName ?? this.humanize(filename),
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

  /** Escape glob metacharacters so id (e.g. with parentheses) matches literally. */
  private escapeGlob(id: string): string {
    return id.replace(/[*?[\](){}!\\]/g, '\\$&')
  }

  private async findFilename(
    category: SoundCategory,
    id: string,
  ): Promise<string> {
    const base = this.resolvePath(category)
    const escaped = this.escapeGlob(id)
    const matches = await fg(`${escaped}.*`, {
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
    await Promise.all([
      this.soundTags.setTags(category, id, []),
      this.soundDisplayNames.deleteDisplayName(category, id),
    ])
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
