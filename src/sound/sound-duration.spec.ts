import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDurationMs } from './sound-duration'

const FIXTURES_DIR = join(__dirname, '..', 'audio', 'decoders', 'fixtures')

describe('readDurationMs', () => {
  it.each([
    ['fixture-stereo-44100.mp3'],
    ['fixture-stereo-44100.ogg'],
    ['fixture-stereo-44100.flac'],
    ['fixture-mono-22050.wav'],
    ['fixture.m4a'],
  ])('reads the duration of %s from its header', async (file) => {
    const ms = await readDurationMs(join(FIXTURES_DIR, file))
    // every fixture is roughly 0.3 s of audio; mp3 adds encoder padding
    expect(ms).toBeGreaterThanOrEqual(290)
    expect(ms).toBeLessThanOrEqual(360)
  })

  it('is null for a file with no audio frames to read a duration from', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hibiki-duration-'))
    const path = join(dir, 'notes.mp3')
    writeFileSync(path, 'not audio')
    await expect(readDurationMs(path)).resolves.toBeNull()
  })
})
