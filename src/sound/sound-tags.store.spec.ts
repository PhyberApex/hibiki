import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { clearStorageWarnings, getStorageWarnings } from '../json-file'
import { createSoundTagsStore, normalizeTags } from './sound-tags.store'

describe('createSoundTagsStore', () => {
  let config: ReturnType<typeof makeConfig>

  function makeConfig() {
    const root = mkdtempSync(join(tmpdir(), 'hibiki-sound-tags-'))
    return {
      discord: { token: '' },
      audio: {
        storageRoot: root,
        musicDir: join(root, 'music'),
        effectsDir: join(root, 'effects'),
        webDistDir: 'web-dist',
      },
      database: { path: join(root, 'data', 'hibiki.json') },
    }
  }

  beforeEach(() => {
    config = makeConfig()
    clearStorageWarnings()
  })

  it('get returns empty array when no tags are set', async () => {
    const store = createSoundTagsStore(config)
    const tags = await store.get('music', 'track-1')
    expect(tags).toEqual([])
  })

  it('set and get roundtrip, normalizing whitespace and blanks', async () => {
    const store = createSoundTagsStore(config)
    const saved = await store.set('music', 'track-1', [' tavern ', '', 'night  '])
    expect(saved).toEqual(['tavern', 'night'])
    const tags = await store.get('music', 'track-1')
    expect(tags).toEqual(['tavern', 'night'])
  })

  it('set with no tags removes the key', async () => {
    const store = createSoundTagsStore(config)
    await store.set('music', 'track-1', ['tavern'])
    await store.set('music', 'track-1', [])
    expect(await store.get('music', 'track-1')).toEqual([])
  })

  it('getAll scopes results to one category by stripping the key prefix', async () => {
    const store = createSoundTagsStore(config)
    await store.set('music', 'track-1', ['tavern'])
    await store.set('ambience', 'rain', ['storm'])
    const musicTags = await store.getAll('music')
    expect(musicTags.get('track-1')).toEqual(['tavern'])
    expect(musicTags.has('rain')).toBe(false)
  })

  it('remove deletes the tags for one sound without touching others', async () => {
    const store = createSoundTagsStore(config)
    await store.set('music', 'track-1', ['tavern'])
    await store.set('music', 'track-2', ['battle'])
    await store.remove('music', 'track-1')
    expect(await store.get('music', 'track-1')).toEqual([])
    expect(await store.get('music', 'track-2')).toEqual(['battle'])
  })

  it('a truncated sound-tags.json is preserved as a backup, and saving afterwards does not destroy it', async () => {
    const tagsPath = resolve(process.cwd(), dirname(config.database.path), 'sound-tags.json')
    mkdirSync(dirname(tagsPath), { recursive: true })
    writeFileSync(tagsPath, '{"music/track-1": ["trunc')

    const store = createSoundTagsStore(config)
    const tagsOnLoad = await store.get('music', 'track-1')
    expect(tagsOnLoad).toEqual([])

    const warnings = getStorageWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.file).toBe(tagsPath)
    expect(readFileSync(warnings[0]!.backupPath, 'utf-8')).toBe('{"music/track-1": ["trunc')

    await store.set('music', 'track-2', ['battle'])
    expect(readFileSync(warnings[0]!.backupPath, 'utf-8')).toBe('{"music/track-1": ["trunc')
    expect(await store.get('music', 'track-2')).toEqual(['battle'])
  })

  it('normalizeTags trims and drops blank entries', () => {
    expect(normalizeTags([' a ', '', '  ', 'b'])).toEqual(['a', 'b'])
  })
})
