import type { Repository } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In } from 'typeorm'
import { SoundTag } from './sound-tag.entity'

@Injectable()
export class SoundTagService {
  constructor(
    @InjectRepository(SoundTag)
    private readonly repo: Repository<SoundTag>,
  ) {}

  async getTags(category: string, soundId: string): Promise<string[]> {
    const rows = await this.repo.find({
      where: { category, soundId },
      order: { tag: 'ASC' },
    })
    return rows.map(r => r.tag)
  }

  async setTags(category: string, soundId: string, tags: string[]): Promise<void> {
    const normalized = [...new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))]
    await this.repo.delete({ category, soundId })
    if (normalized.length > 0) {
      await this.repo.insert(
        normalized.map(tag => ({ category, soundId, tag })),
      )
    }
  }

  async getTagsBySoundIds(category: string, soundIds: string[]): Promise<Map<string, string[]>> {
    if (soundIds.length === 0)
      return new Map()
    const rows = await this.repo.find({
      where: { category, soundId: In(soundIds) },
      order: { tag: 'ASC' },
    })
    const map = new Map<string, string[]>()
    for (const row of rows) {
      const list = map.get(row.soundId) ?? []
      list.push(row.tag)
      map.set(row.soundId, list)
    }
    return map
  }

  async getSoundIdsWithTag(category: string, tag: string): Promise<Set<string>> {
    const rows = await this.repo.find({
      where: { category, tag: tag.trim().toLowerCase() },
    })
    return new Set(rows.map(r => r.soundId))
  }

  async getDistinctTags(category: string): Promise<string[]> {
    const rows = await this.repo
      .createQueryBuilder('t')
      .select('DISTINCT t.tag')
      .where('t.category = :category', { category })
      .orderBy('t.tag', 'ASC')
      .getRawMany<{ tag: string }>()
    return rows.map(r => r.tag)
  }
}
