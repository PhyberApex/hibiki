import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'app_config' })
export class AppConfig {
  @PrimaryColumn()
  key!: string

  @Column({ type: 'text' })
  value!: string
}
