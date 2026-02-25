export type SoundCategory = 'music' | 'effects' | 'ambience'

export interface SoundFile {
  id: string
  name: string
  filename: string
  size: number
  category: SoundCategory
  createdAt: string
}
