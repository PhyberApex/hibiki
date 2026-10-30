import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { exportScene } from './scene-export'

describe('exportScene', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-export-'))
  const musicDir = join(tempRoot, 'music')
  const effectsDir = join(tempRoot, 'effects')
  const ambienceDir = join(tempRoot, 'ambience')
  const config = {
    discord: { token: '' },
    audio: {
      storageRoot: tempRoot,
      musicDir,
      effectsDir,
      ambienceDir,
      webDistDir: 'web-dist',
    },
    database: {
      path: join(tempRoot, 'data', 'hibiki.json'),
    },
  }

  beforeEach(() => {
    delete process.env.HIBIKI_USER_DATA
    mkdirSync(join(tempRoot, 'data'), { recursive: true })
    mkdirSync(musicDir, { recursive: true })
    mkdirSync(effectsDir, { recursive: true })
    mkdirSync(ambienceDir, { recursive: true })
  })

  it('throws when scene not found', async () => {
    const targetZip = join(tempRoot, 'missing.zip')
    await expect(exportScene(config, 'nonexistent', targetZip)).rejects.toThrow(
      'Scene \'nonexistent\' not found',
    )
  })

  it('exports a zip containing hibiki-scene.json and skips missing sounds', async () => {
    const { createSceneStore } = await import('./scene-store')
    const store = createSceneStore(config)
    const saved = await store.save({
      name: 'Export Test',
      ambience: [
        { soundId: 'missing-ambience' },
      ],
      music: [],
      effects: [],
    })
    const targetZip = join(tempRoot, 'export-out.zip')
    await exportScene(config, saved.id, targetZip)

    const zip = new AdmZip(targetZip)
    const manifestEntry = zip.getEntry('hibiki-scene.json')
    expect(manifestEntry).toBeDefined()
    const data = JSON.parse(manifestEntry!.getData().toString('utf-8'))
    expect(data.formatVersion).toBe(1)
    expect(data.displayName).toBe('Export Test')
    expect(data.scene).toBeDefined()
    expect(data.scene.ambience).toHaveLength(1)
    expect(data.scene.ambience[0].bundled).toBe(false)
  })

  it('omits every hotkey from the manifest', async () => {
    const { createSceneStore } = await import('./scene-store')
    const saved = await createSceneStore(config).save({
      name: 'Hot',
      hotkey: 'F1',
      effects: [
        { soundId: 'missing', soundName: 'Boom', hotkey: 'F2' },
      ],
    })
    const targetZip = join(tempRoot, 'hot.zip')
    await exportScene(config, saved.id, targetZip)
    const raw = new AdmZip(targetZip).getEntry('hibiki-scene.json')!.getData().toString('utf-8')
    expect(raw.toLowerCase()).not.toContain('hotkey')
  })

  it('writes the Music Mode into the manifest, single when the Scene has none', async () => {
    const { createSceneStore } = await import('./scene-store')
    const store = createSceneStore(config)
    const seq = await store.save({ name: 'Seq', musicMode: 'sequential' })
    const plain = await store.save({ name: 'Plain' })
    const read = async (id: string) => {
      const targetZip = join(tempRoot, `${id}.zip`)
      await exportScene(config, id, targetZip)
      return JSON.parse(new AdmZip(targetZip).getEntry('hibiki-scene.json')!.getData().toString('utf-8'))
    }
    expect((await read(seq.id)).scene.musicMode).toBe('sequential')
    expect((await read(plain.id)).scene.musicMode).toBe('single')
  })

  function readManifest(zipPath: string) {
    return JSON.parse(new AdmZip(zipPath).getEntry('hibiki-scene.json')!.getData().toString('utf-8'))
  }

  it('exports a Scene with empty categories as a manifest with empty lists and no sounds', async () => {
    const { createSceneStore } = await import('./scene-store')
    const saved = await createSceneStore(config).save({ name: 'Empty  Scene!' })
    const targetZip = join(tempRoot, 'empty-scene.zip')
    await exportScene(config, saved.id, targetZip)

    const zip = new AdmZip(targetZip)
    expect(zip.getEntries().map(e => e.entryName)).toEqual(['hibiki-scene.json'])
    const data = readManifest(targetZip)
    expect(data.name).toBe('empty-scene')
    expect(data.scene).toMatchObject({ music: [], ambience: [], effects: [] })
  })

  it('bundles each referenced sound once per category and carries item settings', async () => {
    writeFileSync(join(musicDir, 'theme-1.mp3'), 'music-bytes')
    writeFileSync(join(ambienceDir, 'rain-2.ogg'), 'ambience-bytes')
    writeFileSync(join(effectsDir, 'boom-3.wav'), 'effect-bytes')
    const { createSceneStore } = await import('./scene-store')
    const saved = await createSceneStore(config).save({
      name: 'Bundled',
      music: [
        {
          soundId: 'theme-1',
          soundName: 'Theme',
          volume: 80,
          loop: true,
        },
        { soundId: 'theme-1', soundName: 'Theme again', volume: 60 },
      ],
      ambience: [
        {
          soundId: 'rain-2',
          volume: 40,
          enabled: false,
          source: { name: 'Rain pack' },
        },
      ],
      effects: [
        { soundId: 'boom-3', soundName: 'Boom' },
      ],
    })
    const targetZip = join(tempRoot, 'bundled.zip')
    await exportScene(config, saved.id, targetZip)

    const zip = new AdmZip(targetZip)
    expect(zip.getEntries().map(e => e.entryName).sort()).toEqual([
      'hibiki-scene.json',
      'sounds/ambience/rain-2.ogg',
      'sounds/effects/boom-3.wav',
      'sounds/music/theme-1.mp3',
    ])
    expect(zip.getEntry('sounds/music/theme-1.mp3')!.getData().toString('utf-8')).toBe('music-bytes')

    const { scene } = readManifest(targetZip)
    expect(scene.music).toEqual([
      {
        soundName: 'Theme',
        volume: 80,
        bundled: true,
        bundledPath: 'sounds/music/theme-1.mp3',
        loop: true,
      },
      {
        soundName: 'Theme again',
        volume: 60,
        bundled: true,
        bundledPath: 'sounds/music/theme-1.mp3',
      },
    ])
    expect(scene.ambience).toEqual([
      {
        soundName: 'rain-2',
        volume: 40,
        bundled: true,
        bundledPath: 'sounds/ambience/rain-2.ogg',
        enabled: false,
        source: { name: 'Rain pack' },
      },
    ])
    expect(scene.effects).toEqual([
      { soundName: 'Boom', bundled: true, bundledPath: 'sounds/effects/boom-3.wav' },
    ])
  })

  it('carries an Ambience item\'s repeat interval (#708)', async () => {
    const { createSceneStore } = await import('./scene-store')
    const saved = await createSceneStore(config).save({
      name: 'Storm',
      ambience: [
        {
          soundId: 'thunder',
          volume: 70,
          repeatMin: 20,
          repeatMax: 90,
        },
      ],
    })
    const targetZip = join(tempRoot, 'repeat.zip')
    await exportScene(config, saved.id, targetZip)

    expect(readManifest(targetZip).scene.ambience).toEqual([
      {
        soundName: 'thunder',
        volume: 70,
        bundled: false,
        repeatMin: 20,
        repeatMax: 90,
      },
    ])
  })

  it('logs when the export starts and how long it took, with the bundled bytes (#710)', async () => {
    writeFileSync(join(musicDir, 'logged-6.mp3'), 'ten-bytes!')
    const { createSceneStore } = await import('./scene-store')
    const saved = await createSceneStore(config).save({
      name: 'Logged Export',
      music: [
        { soundId: 'logged-6', soundName: 'Logged' },
      ],
    })
    const info = jest.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const targetZip = join(tempRoot, 'logged.zip')
      await exportScene(config, saved.id, targetZip)

      const lines = info.mock.calls.map(args => args.join(' '))
      expect(lines).toContain(`[scene-export] Export started: "Logged Export" (${saved.id}), Music Mode single, 1 sound(s) to bundle`)
      expect(lines).toContainEqual(expect.stringMatching(/^\[scene-export\] Export finished in \d+ ms: 1 sound\(s\), 10 bytes, \d+-byte archive written to /))
    }
    finally {
      info.mockRestore()
    }
  })

  it('creates the target folder when it does not exist yet', async () => {
    const { createSceneStore } = await import('./scene-store')
    const saved = await createSceneStore(config).save({ name: 'Nested Target' })
    const targetZip = join(tempRoot, 'not-yet', 'there', 'nested.zip')
    await exportScene(config, saved.id, targetZip)
    expect(readManifest(targetZip).displayName).toBe('Nested Target')
  })

  it('bundles the sounds it finds and references the ones missing on disk', async () => {
    writeFileSync(join(effectsDir, 'present-4.wav'), 'here')
    const { createSceneStore } = await import('./scene-store')
    const saved = await createSceneStore(config).save({
      name: 'Partly Missing',
      effects: [
        { soundId: 'present-4', soundName: 'Present' },
        { soundId: 'gone-5', soundName: 'Gone' },
      ],
    })
    const targetZip = join(tempRoot, 'partly-missing.zip')
    await exportScene(config, saved.id, targetZip)

    const { scene } = readManifest(targetZip)
    expect(scene.effects).toEqual([
      { soundName: 'Present', bundled: true, bundledPath: 'sounds/effects/present-4.wav' },
      { soundName: 'Gone', bundled: false },
    ])
    expect(new AdmZip(targetZip).getEntry('sounds/effects/gone-5.wav')).toBeNull()
  })
})
