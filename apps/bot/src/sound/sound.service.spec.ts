import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { Readable } from 'stream';
import { tmpdir } from 'os';
import { join } from 'path';
import { SoundTagService } from '../persistence/sound-tag.service';
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

function createMockSoundTagService(): jest.Mocked<SoundTagService> {
  return {
    getTagsBySoundIds: jest.fn().mockResolvedValue(new Map()),
    getSoundIdsWithTag: jest.fn().mockResolvedValue(new Set()),
    setTags: jest.fn().mockResolvedValue(undefined),
    getDistinctTags: jest.fn().mockResolvedValue([]),
    getTags: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<SoundTagService>;
}

describe('SoundLibraryService', () => {
  let tempRoot: string;
  let musicDir: string;
  let effectsDir: string;
  let service: SoundLibraryService;
  let soundTags: jest.Mocked<SoundTagService>;

  beforeEach(async () => {
    tempRoot = createTempDir();
    musicDir = join(tempRoot, 'music');
    effectsDir = join(tempRoot, 'effects');
    const config = new ConfigService({
      audio: { musicDir, effectsDir },
    });
    soundTags = createMockSoundTagService();

    service = new SoundLibraryService(config, soundTags);
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

  it('lists with tag filter when tag service returns matching ids', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    await service.save('music', createFile('a.mp3', 'a'));
    await service.save('music', createFile('b.mp3', 'b'));
    (soundTags.getTagsBySoundIds as jest.Mock).mockResolvedValue(
      new Map([['a-1700000000000', ['ambient']], ['b-1700000000000', []]]),
    );
    (soundTags.getSoundIdsWithTag as jest.Mock).mockResolvedValue(
      new Set(['a-1700000000000']),
    );

    const list = await service.list('music', 'ambient');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a-1700000000000');
    expect(list[0].tags).toEqual(['ambient']);
    nowSpy.mockRestore();
  });

  it('getStream returns stream and filename for existing file', async () => {
    writeFileSync(join(musicDir, 'test.mp3'), 'data');
    const { stream, filename } = await service.getStream('music', 'test');
    expect(filename).toBe('test.mp3');
    expect(stream).toBeDefined();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe('data');
  });

  it('setTags calls sound tag service after resolving file', async () => {
    writeFileSync(join(musicDir, 'x.mp3'), 'x');
    await service.setTags('music', 'x', ['tag1', 'tag2']);
    expect(soundTags.setTags).toHaveBeenCalledWith('music', 'x', ['tag1', 'tag2']);
  });

  it('getDistinctTags delegates to sound tag service', async () => {
    (soundTags.getDistinctTags as jest.Mock).mockResolvedValue(['a', 'b']);
    const tags = await service.getDistinctTags('music');
    expect(tags).toEqual(['a', 'b']);
    expect(soundTags.getDistinctTags).toHaveBeenCalledWith('music');
  });
});
