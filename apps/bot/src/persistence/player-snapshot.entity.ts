import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { SoundCategory } from '../sound/sound.types';

@Entity({ name: 'player_snapshots' })
export class PlayerSnapshot {
  @PrimaryColumn()
  guildId!: string;

  @Column({ nullable: true })
  connectedChannelId?: string;

  @Column({ nullable: true })
  connectedChannelName?: string;

  @Column({ nullable: true })
  trackId?: string;

  @Column({ nullable: true })
  trackName?: string;

  @Column({ nullable: true })
  trackFilename?: string | null;

  @Column({ nullable: true })
  trackCategory?: SoundCategory | null;

  @Column({ default: true })
  isIdle!: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}
