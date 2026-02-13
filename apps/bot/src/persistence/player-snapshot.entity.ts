import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'player_snapshots' })
export class PlayerSnapshot {
  @PrimaryColumn()
  guildId!: string

  @Column({ nullable: true })
  connectedChannelId?: string

  @Column({ nullable: true })
  connectedChannelName?: string

  @Column({ nullable: true })
  trackId?: string

  @Column({ nullable: true })
  trackName?: string

  @Column({ nullable: true })
  trackFilename?: string

  @Column({ nullable: true })
  trackCategory?: string

  @Column({ default: true })
  isIdle!: boolean

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date
}
