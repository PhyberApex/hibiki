import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'sound_tags' })
export class SoundTag {
  @PrimaryColumn()
  category!: string;

  @PrimaryColumn()
  soundId!: string;

  @PrimaryColumn()
  tag!: string;
}
