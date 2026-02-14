import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { SoundLibraryService } from './sound.service';
import { SoundController } from './controllers/sound.controller';

@Module({
  imports: [PersistenceModule],
  providers: [SoundLibraryService],
  controllers: [SoundController],
  exports: [SoundLibraryService],
})
export class SoundModule {}
