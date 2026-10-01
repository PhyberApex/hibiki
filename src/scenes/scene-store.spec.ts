import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { clearStorageWarnings, getStorageWarnings } from '../json-file'
import { createSceneStore } from './scene-store'

describe('createSceneStore', () => {
  let config: ReturnType<typeof makeConfig>

  function makeConfig() {
    const root = mkdtempSync(join(tmpdir(), 'hibiki-scenes-'))
    return {
      discord: { token: '' },
      audio: {
        storageRoot: root,
        musicDir: join(root, 'music'),
        effectsDir: join(root, 'effects'),
        ambienceDir: join(root, 'ambience'),
        webDistDir: 'web-dist',
      },
      database: { path: join(root, 'data', 'hibiki.json') },
    }
  }

  beforeEach(() => {
    config = makeConfig()
    delete process.env.HIBIKI_USER_DATA
    clearStorageWarnings()
  })

  it('list returns empty array when no scenes', async () => {
    const store = createSceneStore(config)
    const scenes = await store.list()
    expect(scenes).toEqual([])
  })

  it('save creates new scene with generated id', async () => {
    const store = createSceneStore(config)
    const saved = await store.save({ name: 'Test Scene' })
    expect(saved.id).toBeDefined()
    expect(saved.name).toBe('Test Scene')
    expect(saved.ambience).toEqual([])
    expect(saved.music).toEqual([])
    expect(saved.effects).toEqual([])
    expect(saved.createdAt).toBeDefined()
    expect(saved.updatedAt).toBeDefined()
  })

  it('save persists and list returns it', async () => {
    const store = createSceneStore(config)
    const saved = await store.save({ name: 'My Scene', ambience: [{ soundId: 'rain', volume: 80 }] })
    const scenes = await store.list()
    expect(scenes).toHaveLength(1)
    expect(scenes[0]!.id).toBe(saved.id)
    expect(scenes[0]!.name).toBe('My Scene')
    expect(scenes[0]!.ambience).toHaveLength(1)
    expect(scenes[0]!.ambience![0]!.soundId).toBe('rain')
  })

  it('get returns scene by id', async () => {
    const store = createSceneStore(config)
    const saved = await store.save({ name: 'Find Me' })
    const found = await store.get(saved.id)
    expect(found).not.toBeNull()
    expect(found!.name).toBe('Find Me')
  })

  it('get returns null for missing id', async () => {
    const store = createSceneStore(config)
    const found = await store.get('nonexistent')
    expect(found).toBeNull()
  })

  it('save updates existing scene', async () => {
    const store = createSceneStore(config)
    const saved = await store.save({ name: 'Original' })
    const updated = await store.save({ id: saved.id, name: 'Updated' })
    expect(updated.id).toBe(saved.id)
    expect(updated.name).toBe('Updated')
    expect(updated.createdAt).toBe(saved.createdAt)
    const scenes = await store.list()
    expect(scenes).toHaveLength(1)
  })

  it('remove deletes scene', async () => {
    const store = createSceneStore(config)
    const saved = await store.save({ name: 'To Remove' })
    await store.remove(saved.id)
    const found = await store.get(saved.id)
    expect(found).toBeNull()
    const scenes = await store.list()
    expect(scenes).toHaveLength(0)
  })

  it('remove throws for missing id', async () => {
    const store = createSceneStore(config)
    await expect(store.remove('nonexistent')).rejects.toThrow('Scene \'nonexistent\' not found')
  })

  it('a truncated scenes.json is preserved as a backup, and saving afterwards does not destroy it', async () => {
    const scenesPath = join(dirname(config.database.path), 'scenes.json')
    mkdirSync(dirname(scenesPath), { recursive: true })
    writeFileSync(scenesPath, '[{"id": "truncat')

    const store = createSceneStore(config)
    const scenesOnLoad = await store.list()
    expect(scenesOnLoad).toEqual([])

    const warnings = getStorageWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.file).toBe(scenesPath)
    expect(readFileSync(warnings[0]!.backupPath, 'utf-8')).toBe('[{"id": "truncat')

    await store.save({ name: 'After Corruption' })
    expect(readFileSync(warnings[0]!.backupPath, 'utf-8')).toBe('[{"id": "truncat')
    const scenesAfterSave = await store.list()
    expect(scenesAfterSave).toHaveLength(1)
    expect(scenesAfterSave[0]!.name).toBe('After Corruption')
  })

  it('never writes directly to the live file', async () => {
    const store = createSceneStore(config)
    await store.save({ name: 'Atomic' })
    const scenesPath = join(dirname(config.database.path), 'scenes.json')
    const entries = await readdir(dirname(scenesPath))
    expect(entries).not.toContain('scenes.json.tmp')
  })
})
