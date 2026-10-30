export type SoundCategory = 'music' | 'effects' | 'ambience'

export interface SoundFile {
  id: string
  name: string
  filename: string
  size: number
  category: SoundCategory
  createdAt: string
  tags: string[]
  /** Music only (#695): read from the file's header; absent when it could not be read. */
  durationMs?: number
}
