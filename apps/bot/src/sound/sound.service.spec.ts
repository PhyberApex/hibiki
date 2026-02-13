import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { Readable } from 'stream';
import { tmpdir } from 'os';
import { join } from 'path';
import { SoundLibraryService } from './sound.service';

const createTempDir = () => mkdtempSync(join(tmpdir(), 'hibiki-sound-'));

function createFile(name: string, data: string): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'audio/mpeg',
    size: Buffer.byteLength(data),
    destination: '',
    filename: name,
    path: '',
    buffer: Buffer.from(data),
    stream: Readable.from(data),
  } as Express.Multer.File;
}

describe('SoundLibraryService', () => {
  let tempRoot: string;
  let musicDir: string;
  let effectsDir: string;
  let service: SoundLibraryService;

  beforeEach(async () => {
    tempRoot = createTempDir();
    musicDir = join(tempRoot, 'music');
    effectsDir = join(tempRoot, 'effects');
    const config = new ConfigService({
      audio: { musicDir, effectsDir },
    });

    service = new SoundLibraryService(config);
    await service.onModuleInit();
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('saves and lists music files', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    await service.save('music', createFile('Lo-Fi Vibes.mp3', 'music-data'));

    const files = await service.list('music');
    expect(files).toHaveLength(1);
    expect(files[0].id).toEqual(expect.stringContaining('lo-fi-vibes'));
    expect(files[0].category).toBe('music');
    expect(files[0].name).toEqual(expect.stringContaining('Lo Fi Vibes'));
    nowSpy.mockRestore();
  });

  it('removes files by id', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const saved = await service.save('effects', createFile('boom.wav', 'boom'));

    await service.remove('effects', saved.id);

    await expect(service.list('effects')).resolves.toHaveLength(0);
    nowSpy.mockRestore();
  });

  it('finds files created outside the service', async () => {
    const customFile = join(musicDir, 'manual-track.mp3');
    writeFileSync(customFile, 'manual');

    const file = await service.getFile('music', 'manual-track');
    expect(file.path).toBe(customFile);
    expect(file.name).toBe('Manual Track');
  });
});
