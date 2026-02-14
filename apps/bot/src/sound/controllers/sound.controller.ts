import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SoundLibraryService } from '../sound.service';
import { SoundFile } from '../sound.types';

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

@Controller('sounds')
export class SoundController {
  constructor(private readonly sounds: SoundLibraryService) {}

  @Get('music')
  listMusic(@Query('tag') tag?: string): Promise<SoundFile[]> {
    return this.sounds.list('music', tag);
  }

  @Get('effects')
  listEffects(@Query('tag') tag?: string): Promise<SoundFile[]> {
    return this.sounds.list('effects', tag);
  }

  @Get('music/tags')
  listMusicTags(): Promise<string[]> {
    return this.sounds.getDistinctTags('music');
  }

  @Get('effects/tags')
  listEffectsTags(): Promise<string[]> {
    return this.sounds.getDistinctTags('effects');
  }

  @Patch('music/:id/tags')
  setMusicTags(
    @Param('id') id: string,
    @Body() body: { tags: string[] },
  ): Promise<{ tags: string[] }> {
    const tags = Array.isArray(body?.tags) ? body.tags : [];
    return this.sounds.setTags('music', id, tags).then(() => ({
      tags: [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
    }));
  }

  @Patch('effects/:id/tags')
  setEffectsTags(
    @Param('id') id: string,
    @Body() body: { tags: string[] },
  ): Promise<{ tags: string[] }> {
    const tags = Array.isArray(body?.tags) ? body.tags : [];
    return this.sounds.setTags('effects', id, tags).then(() => ({
      tags: [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
    }));
  }

  @Get('music/:id/file')
  async streamMusic(@Param('id') id: string) {
    const { stream, filename } = await this.sounds.getStream('music', id);
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    const type = MIME_BY_EXT[ext] ?? 'audio/mpeg';
    return new StreamableFile(stream, { type });
  }

  @Get('effects/:id/file')
  async streamEffect(@Param('id') id: string) {
    const { stream, filename } = await this.sounds.getStream('effects', id);
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    const type = MIME_BY_EXT[ext] ?? 'audio/wav';
    return new StreamableFile(stream, { type });
  }

  @Post('music')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMusic(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.sounds.save('music', file);
  }

  @Post('effects')
  @UseInterceptors(FileInterceptor('file'))
  async uploadEffect(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.sounds.save('effects', file);
  }

  @Delete('music/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMusic(@Param('id') id: string) {
    return this.sounds.remove('music', id);
  }

  @Delete('effects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEffect(@Param('id') id: string) {
    return this.sounds.remove('effects', id);
  }
}
