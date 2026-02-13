import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { SoundCategory } from '../sound/sound.types';

@Entity({ name: 'player_snapshots' })
export class PlayerSnapshot {
  @PrimaryColumn()
  guildId!: string;

  @Column({ type: 'varchar', nullable: true })
  connectedChannelId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  connectedChannelName?: string | null;

  @Column({ type: 'varchar', nullable: true })
  trackId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  trackName?: string | null;

  @Column({ type: 'text', nullable: true })
  trackFilename?: string | null;

  @Column({ type: 'varchar', nullable: true })
  trackCategory?: SoundCategory | null;

  @Column({ default: true })
  isIdle!: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}
