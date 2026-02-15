import { Module } from '@nestjs/common'
import { PersistenceModule } from '../persistence/persistence.module'
import { SoundController } from './controllers/sound.controller'
import { SoundLibraryService } from './sound.service'

@Module({
  imports: [PersistenceModule],
  providers: [SoundLibraryService],
  controllers: [SoundController],
  exports: [SoundLibraryService],
})
export class SoundModule {}
