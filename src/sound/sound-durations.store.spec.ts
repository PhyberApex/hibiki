import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { clearStorageWarnings } from '../json-file'
import { createSoundDurationsStore } from './sound-durations.store'

describe('createSoundDurationsStore', () => {
  let config: ReturnType<typeof makeConfig>

  function makeConfig() {
    const root = mkdtempSync(join(tmpdir(), 'hibiki-sound-durations-'))
    return {
      discord: { token: '' },
      audio: {
        storageRoot: root,
        musicDir: join(root, 'music'),
        effectsDir: join(root, 'effects'),
        webDistDir: 'web-dist',
      },
      database: {
        path: join(root, 'data', 'hibiki.json'),
      },
    }
  }

  beforeEach(() => {
    config = makeConfig()
    clearStorageWarnings()
  })

  it('getAll is empty before anything was measured', async () => {
    const store = createSoundDurationsStore(config)
    expect((await store.getAll('music')).size).toBe(0)
  })

  it('setMany and getAll roundtrip, keeping an unreadable (null) entry and scoping per category', async () => {
    const store = createSoundDurationsStore(config)
    await store.setMany('music', new Map([
      ['tavern', 184_000],
      ['broken', null],
    ]))
    await store.setMany('ambience', new Map([
      ['rain', 60_000],
    ]))
    const music = await store.getAll('music')
    expect(music.get('tavern')).toBe(184_000)
    expect(music.has('broken')).toBe(true)
    expect(music.get('broken')).toBeNull()
    expect(music.has('rain')).toBe(false)
  })

  it('remove drops one sound without touching others', async () => {
    const store = createSoundDurationsStore(config)
    await store.setMany('music', new Map([
      ['a', 1000],
      ['b', 2000],
    ]))
    await store.remove('music', 'a')
    const music = await store.getAll('music')
    expect(music.has('a')).toBe(false)
    expect(music.get('b')).toBe(2000)
  })

  it('ignores hand-edited entries that are not a positive duration or null', async () => {
    const path = resolve(process.cwd(), dirname(config.database.path), 'sound-durations.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ 'music/a': 'long', 'music/b': -5, 'music/c': 1200 }))
    const music = await createSoundDurationsStore(config).getAll('music')
    expect([...music]).toEqual([
      ['c', 1200],
    ])
  })
})
