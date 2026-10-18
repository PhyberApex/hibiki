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

  describe('hotkeys', () => {
    const fx = (soundId: string, hotkey?: string) => ({ soundId, soundName: soundId, hotkey })

    it('stores normalised Scene and Effect Hotkeys', async () => {
      const store = createSceneStore(config)
      const saved = await store.save({ name: 'A', hotkey: 'shift+ctrl+1', effects: [fx('boom', 'f13')] })
      expect(saved.hotkey).toBe('Ctrl+Shift+1')
      expect(saved.effects[0].hotkey).toBe('F13')
      expect((await store.get(saved.id))?.hotkey).toBe('Ctrl+Shift+1')
    })

    it('drops empty hotkeys and hotkeys on music/ambience items', async () => {
      const store = createSceneStore(config)
      const saved = await store.save({
        name: 'A',
        hotkey: '',
        effects: [fx('boom', ' ')],
        music: [{ soundId: 'm', hotkey: 'F1' }],
        ambience: [{ soundId: 'a', hotkey: 'F2' }],
      })
      expect(saved).not.toHaveProperty('hotkey')
      expect(saved.effects[0]).not.toHaveProperty('hotkey')
      expect(saved.music[0]).not.toHaveProperty('hotkey')
      expect(saved.ambience[0]).not.toHaveProperty('hotkey')
    })

    it('rejects an invalid accelerator', async () => {
      const store = createSceneStore(config)
      await expect(store.save({ name: 'A', hotkey: 'Ctrl+' })).rejects.toThrow('Invalid hotkey')
    })

    it('rejects the same key on two Scenes, naming the owner', async () => {
      const store = createSceneStore(config)
      await store.save({ name: 'Tavern', hotkey: 'Ctrl+1' })
      await expect(store.save({ name: 'Cave', hotkey: 'ctrl+1' })).rejects.toThrow('already used by Scene "Tavern"')
      expect(await store.list()).toHaveLength(1)
    })

    it('allows a Scene to keep its own Hotkey when re-saved', async () => {
      const store = createSceneStore(config)
      const a = await store.save({ name: 'Tavern', hotkey: 'Ctrl+1' })
      await expect(store.save({ ...a, name: 'Tavern 2' })).resolves.toMatchObject({ hotkey: 'Ctrl+1' })
    })

    it('rejects the same key on two Effects of one Scene', async () => {
      const store = createSceneStore(config)
      await expect(store.save({ name: 'A', effects: [fx('boom', 'F1'), fx('bang', 'f1')] }))
        .rejects
        .toThrow('already used by Effect "boom" in Scene "A"')
    })

    it('allows the same Effect key in different Scenes', async () => {
      const store = createSceneStore(config)
      await store.save({ name: 'A', effects: [fx('boom', 'F1')] })
      await expect(store.save({ name: 'B', effects: [fx('bang', 'F1')] })).resolves.toBeDefined()
    })

    it('rejects an Effect key held by a Scene Hotkey, in another Scene or its own', async () => {
      const store = createSceneStore(config)
      await store.save({ name: 'A', hotkey: 'F5' })
      await expect(store.save({ name: 'B', effects: [fx('boom', 'F5')] })).rejects.toThrow('Scene "A"')
      await expect(store.save({ name: 'C', hotkey: 'F6', effects: [fx('boom', 'F6')] })).rejects.toThrow('Scene "C"')
    })

    it('rejects a Scene key held by an Effect of another Scene', async () => {
      const store = createSceneStore(config)
      await store.save({ name: 'A', effects: [fx('boom', 'F5')] })
      await expect(store.save({ name: 'B', hotkey: 'F5' })).rejects.toThrow('Effect "boom" in Scene "A"')
    })

    it('rejects Scene and Effect keys that equal the Stop Hotkey', async () => {
      const store = createSceneStore(config, { getActionHotkeys: async () => ({ stopHotkey: 'Ctrl+S' }) })
      await expect(store.save({ name: 'A', hotkey: 'ctrl+s' })).rejects.toThrow('the Stop Hotkey')
      await expect(store.save({ name: 'A', effects: [fx('boom', 'Ctrl+S')] })).rejects.toThrow('the Stop Hotkey')
    })

    it('rejects Scene and Effect keys that equal any other Action Hotkey', async () => {
      const store = createSceneStore(config, { getActionHotkeys: async () => ({ volumeUpHotkey: 'F9', nextSceneHotkey: 'F10' }) })
      await expect(store.save({ name: 'A', hotkey: 'F9' })).rejects.toThrow('the Volume Up Hotkey')
      await expect(store.save({ name: 'A', effects: [fx('boom', 'F10')] })).rejects.toThrow('the Next Scene Hotkey')
    })
  })

  it('keeps a Music Mode, omits single and normalises an invalid value to single', async () => {
    const store = createSceneStore(config)
    const shuffled = await store.save({ name: 'Shuffled', musicMode: 'shuffle' })
    expect(shuffled.musicMode).toBe('shuffle')
    expect((await store.get(shuffled.id))!.musicMode).toBe('shuffle')

    const single = await store.save({ id: shuffled.id, name: 'Shuffled', musicMode: 'single' })
    expect(single).not.toHaveProperty('musicMode')

    const invalid = await store.save({ name: 'Bogus', musicMode: 'repeat-one' as never })
    expect(invalid).not.toHaveProperty('musicMode')
  })

  it('leaves each Music item\'s loop untouched whatever the Music Mode', async () => {
    const store = createSceneStore(config)
    const saved = await store.save({ name: 'Seq', musicMode: 'sequential', music: [{ soundId: 'a', loop: true }] })
    expect(saved.music[0]!.loop).toBe(true)
  })
})
