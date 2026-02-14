import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from './app-config.entity';
import { AppConfigService } from './app-config.service';
import { PlayerSnapshot } from './player-snapshot.entity';
import { PlayerSnapshotService } from './player-snapshot.service';
import { SoundTag } from './sound-tag.entity';
import { SoundTagService } from './sound-tag.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlayerSnapshot, AppConfig, SoundTag]),
  ],
  providers: [PlayerSnapshotService, AppConfigService, SoundTagService],
  exports: [PlayerSnapshotService, AppConfigService, SoundTagService],
})
export class PersistenceModule {}
