import type { Repository } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In } from 'typeorm'
import { SoundDisplayName } from './sound-display-name.entity'

@Injectable()
export class SoundDisplayNameService {
  constructor(
    @InjectRepository(SoundDisplayName)
    private readonly repo: Repository<SoundDisplayName>,
  ) {}

  async getDisplayName(category: string, soundId: string): Promise<string | null> {
    const row = await this.repo.findOne({
      where: { category, soundId },
    })
    return row?.displayName ?? null
  }

  async setDisplayName(
    category: string,
    soundId: string,
    displayName: string,
  ): Promise<void> {
    const trimmed = displayName.trim()
    if (!trimmed) {
      await this.repo.delete({ category, soundId })
      return
    }
    await this.repo.upsert(
      { category, soundId, displayName: trimmed },
      { conflictPaths: ['category', 'soundId'] },
    )
  }

  async getDisplayNamesBySoundIds(
    category: string,
    soundIds: string[],
  ): Promise<Map<string, string>> {
    if (soundIds.length === 0)
      return new Map()
    const rows = await this.repo.find({
      where: { category, soundId: In(soundIds) },
    })
    const map = new Map<string, string>()
    for (const row of rows)
      map.set(row.soundId, row.displayName)
    return map
  }

  async deleteDisplayName(category: string, soundId: string): Promise<void> {
    await this.repo.delete({ category, soundId })
  }
}
