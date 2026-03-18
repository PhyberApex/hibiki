export interface SoundSource {
  name: string
  url?: string
  note?: string
}

export interface ScenePackageItem {
  soundName: string
  volume?: number
  enabled?: boolean
  loop?: boolean
  repeatMin?: number
  repeatMax?: number
  bundled: boolean
  bundledPath?: string
  source?: SoundSource
}

export interface SceneManifest {
  formatVersion: 1
  name: string
  displayName: string
  description: string
  author: string
  version: string
  tags: string[]
  category: string
  license?: string
  homepage?: string
  scene: {
    music: ScenePackageItem[]
    ambience: ScenePackageItem[]
    effects: ScenePackageItem[]
  }
}

export interface RegistryEntry {
  name: string
  slug: string
  description: string
  author: string
  version: string
  tags: string[]
  category: string
  license?: string
  downloadUrl: string
  audioBundled: boolean
  createdAt: string
  updatedAt: string
}

export interface RegistryIndex {
  version: 1
  updatedAt: string
  scenes: RegistryEntry[]
}
