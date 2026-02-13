import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { PermissionGuard } from '../../permissions';
import { FileInterceptor } from '@nestjs/platform-express';
import { SoundLibraryService } from '../sound.service';
import { SoundFile } from '../sound.types';

@Controller('sounds')
export class SoundController {
  constructor(private readonly sounds: SoundLibraryService) {}

  @Get('music')
  @UseGuards(PermissionGuard('sound.music.view'))
  listMusic(): Promise<SoundFile[]> {
    return this.sounds.list('music');
  }

  @Get('effects')
  @UseGuards(PermissionGuard('sound.effects.view'))
  listEffects(): Promise<SoundFile[]> {
    return this.sounds.list('effects');
  }

  @Post('music')
  @UseGuards(PermissionGuard('sound.music.upload'))
  @UseInterceptors(FileInterceptor('file'))
  async uploadMusic(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.sounds.save('music', file);
  }

  @Post('effects')
  @UseGuards(PermissionGuard('sound.effects.upload'))
  @UseInterceptors(FileInterceptor('file'))
  async uploadEffect(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.sounds.save('effects', file);
  }

  @Delete('music/:id')
  @UseGuards(PermissionGuard('sound.music.delete'))
  deleteMusic(@Param('id') id: string) {
    return this.sounds.remove('music', id);
  }

  @Delete('effects/:id')
  @UseGuards(PermissionGuard('sound.effects.delete'))
  deleteEffect(@Param('id') id: string) {
    return this.sounds.remove('effects', id);
  }
}
