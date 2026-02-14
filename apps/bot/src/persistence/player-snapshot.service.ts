import type { Repository } from 'typeorm'
import type { SoundCategory } from '../sound/sound.types'
import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { PlayerSnapshot } from './player-snapshot.entity'

export interface SnapshotPayload {
  guildId: string
  connectedChannelId?: string | null
  connectedChannelName?: string | null
  trackId?: string | null
  trackName?: string | null
  trackFilename?: string | null
  trackCategory?: SoundCategory | null
  isIdle?: boolean
}

@Injectable()
export class PlayerSnapshotService {
  private readonly logger = new Logger(PlayerSnapshotService.name)

  constructor(
    @InjectRepository(PlayerSnapshot)
    private readonly repo: Repository<PlayerSnapshot>,
  ) {}

  async upsert(payload: SnapshotPayload) {
    this.logger.debug(`Snapshot upsert guild=${payload.guildId} channel=${payload.connectedChannelId ?? 'none'} idle=${payload.isIdle ?? true}`)
    const snapshot = this.repo.create({
      guildId: payload.guildId,
      connectedChannelId: payload.connectedChannelId ?? null,
      connectedChannelName: payload.connectedChannelName ?? null,
      trackId: payload.trackId ?? null,
      trackName: payload.trackName ?? null,
      trackFilename: payload.trackFilename ?? null,
      trackCategory: payload.trackCategory ?? null,
      isIdle: payload.isIdle ?? true,
      updatedAt: new Date(),
    })
    await this.repo.save(snapshot)
  }

  async remove(guildId: string) {
    await this.repo.delete({ guildId })
    this.logger.debug(`Snapshot removed guild=${guildId}`)
  }

  async list(): Promise<PlayerSnapshot[]> {
    const list = await this.repo.find({ order: { updatedAt: 'DESC' } })
    this.logger.debug(`Snapshot list: ${list.length} guild(s)`)
    return list
  }
}
