import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'sound_display_names' })
export class SoundDisplayName {
  @PrimaryColumn()
  category!: string

  @PrimaryColumn()
  soundId!: string

  @Column({ type: 'varchar', length: 500 })
  displayName!: string
}
