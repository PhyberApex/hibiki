import { Module } from '@nestjs/common';
import { SoundLibraryService } from './sound.service';
import { SoundController } from './controllers/sound.controller';
import { PermissionsModule } from '../permissions';

@Module({
  imports: [PermissionsModule],
  providers: [SoundLibraryService],
  controllers: [SoundController],
  exports: [SoundLibraryService],
})
export class SoundModule {}
