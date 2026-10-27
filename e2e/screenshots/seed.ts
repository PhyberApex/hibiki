import type { Scene } from '../../src/scenes/scene-store'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMinimalWav } from '../fixtures/minimal-wav.js'

type Category = 'music' | 'ambience' | 'effects'

interface SeedSound {
  id: string
  tags: string[]
}

const SOUNDS: Record<Category, SeedSound[]> = {
  music: [
    {
      id: 'tavern-lute-medley',
      tags: ['tavern', 'cheerful', 'folk'],
    },
    {
      id: 'hearth-and-ale',
      tags: ['tavern', 'warm', 'acoustic'],
    },
    {
      id: 'march-of-the-iron-legion',
      tags: ['battle', 'epic', 'drums'],
    },
    {
      id: 'moonlit-glade',
      tags: ['forest', 'calm', 'mystical'],
    },
  ],
  ambience: [
    {
      id: 'crackling-fireplace',
      tags: ['fire', 'cozy', 'indoor'],
    },
    {
      id: 'tavern-chatter',
      tags: ['crowd', 'tavern', 'voices'],
    },
    {
      id: 'rain-on-rooftops',
      tags: ['rain', 'storm', 'night'],
    },
    {
      id: 'forest-night',
      tags: ['forest', 'crickets', 'night'],
    },
  ],
  effects: [
    {
      id: 'mug-clink',
      tags: ['tavern', 'glass'],
    },
    {
      id: 'door-creak',
      tags: ['door', 'wood'],
    },
    {
      id: 'coin-pouch',
      tags: ['coins', 'loot'],
    },
    {
      id: 'bar-brawl',
      tags: ['fight', 'crowd'],
    },
    {
      id: 'sword-unsheathe',
      tags: ['metal', 'combat'],
    },
    {
      id: 'thunder-crack',
      tags: ['storm', 'loud'],
    },
  ],
}

export const COZY_TAVERN_SCENE_ID = '7a1e4c2b-5d6f-4a8b-9c0d-1e2f3a4b5c6d'

function humanize(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function item(id: string, extra: Partial<Scene['music'][number]> = {}) {
  return {
    soundId: id,
    soundName: humanize(id),
    volume: 80,
    ...extra,
  }
}

const SCENES: Scene[] = [
  {
    id: COZY_TAVERN_SCENE_ID,
    name: 'Cozy Tavern',
    music: [
      item('tavern-lute-medley', { loop: true, volume: 70 }),
      item('hearth-and-ale', { loop: true, volume: 65 }),
    ],
    ambience: [
      item('crackling-fireplace', {
        enabled: true,
        volume: 60,
        repeatMin: 30,
        repeatMax: 120,
      }),
      item('tavern-chatter', {
        enabled: true,
        volume: 45,
        repeatMin: 0,
        repeatMax: 0,
      }),
    ],
    effects: [
      item('mug-clink'),
      item('door-creak'),
      item('coin-pouch'),
      item('bar-brawl'),
    ],
    createdAt: '2026-09-14T18:30:00.000Z',
    updatedAt: '2026-10-03T20:15:00.000Z',
  },
  {
    id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    name: 'Battle at the Bridge',
    music: [
      item('march-of-the-iron-legion', { loop: true, volume: 85 }),
    ],
    ambience: [
      item('rain-on-rooftops', { enabled: true, volume: 50 }),
    ],
    effects: [
      item('sword-unsheathe'),
      item('thunder-crack'),
    ],
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-28T21:40:00.000Z',
  },
  {
    id: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f',
    name: 'Moonlit Forest Camp',
    music: [
      item('moonlit-glade', { loop: true, volume: 55 }),
    ],
    ambience: [
      item('forest-night', {
        enabled: true,
        volume: 70,
        repeatMin: 60,
        repeatMax: 300,
      }),
      item('crackling-fireplace', { enabled: true, volume: 40 }),
    ],
    effects: [],
    createdAt: '2026-08-02T19:00:00.000Z',
    updatedAt: '2026-09-11T22:05:00.000Z',
  },
]

const BOOKMARKS = [
  { name: 'D&D Beyond', url: 'https://www.dndbeyond.com/' },
  { name: 'Tabletop Audio', url: 'https://tabletopaudio.com/' },
  { name: 'Hibiki Scene Packs', url: 'https://phyberapex.github.io/hibiki/' },
]

/**
 * Builds a throwaway Electron user-data directory holding a fully seeded
 * Hibiki library: three scenes, a dozen silent WAV files with Sound Tags,
 * a few bookmarks, and no Discord token or API keys anywhere.
 */
export function seedUserData(): string {
  const root = mkdtempSync(join(tmpdir(), 'hibiki-screenshots-'))
  const dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })

  const tags: Record<string, string[]> = {}
  for (const category of Object.keys(SOUNDS) as Category[]) {
    const dir = join(root, 'storage', category)
    mkdirSync(dir, { recursive: true })
    for (const sound of SOUNDS[category]) {
      writeMinimalWav(join(dir, `${sound.id}.wav`))
      tags[`${category}/${sound.id}`] = sound.tags
    }
  }

  writeFileSync(join(dataDir, 'scenes.json'), JSON.stringify(SCENES, null, 2))
  writeFileSync(join(dataDir, 'sound-tags.json'), JSON.stringify(tags, null, 2))
  writeFileSync(join(dataDir, 'app-config.json'), JSON.stringify({
    bookmarks: JSON.stringify(BOOKMARKS),
  }, null, 2))

  return root
}
