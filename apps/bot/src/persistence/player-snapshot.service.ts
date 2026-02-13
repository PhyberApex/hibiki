import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlayerSnapshot } from './player-snapshot.entity';
import type { SoundCategory } from '../sound/sound.types';

export interface SnapshotPayload {
  guildId: string;
  connectedChannelId?: string | null;
  connectedChannelName?: string | null;
  trackId?: string | null;
  trackName?: string | null;
  trackFilename?: string | null;
  trackCategory?: SoundCategory | null;
  isIdle?: boolean;
}

@Injectable()
export class PlayerSnapshotService {
  constructor(
    @InjectRepository(PlayerSnapshot)
    private readonly repo: Repository<PlayerSnapshot>,
  ) {}

  async upsert(payload: SnapshotPayload) {
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
    });
    await this.repo.save(snapshot);
  }

  async remove(guildId: string) {
    await this.repo.delete({ guildId });
  }

  async list(): Promise<PlayerSnapshot[]> {
    return this.repo.find({ order: { updatedAt: 'DESC' } });
  }
}
