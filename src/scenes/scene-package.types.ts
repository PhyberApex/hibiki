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

export interface RegistryTrack {
  soundName: string
  volume?: number
  enabled?: boolean
  loop?: boolean
  source: SoundSource
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
  audioBundled: false
  createdAt: string
  updatedAt: string
  scene: {
    music: RegistryTrack[]
    ambience: RegistryTrack[]
    effects: RegistryTrack[]
  }
}

export interface RegistryIndex {
  version: 1
  updatedAt: string
  scenes: RegistryEntry[]
}
