import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AppConfig } from './app-config.entity'
import { AppConfigService } from './app-config.service'
import { PlayerSnapshot } from './player-snapshot.entity'
import { PlayerSnapshotService } from './player-snapshot.service'
import { SoundDisplayName } from './sound-display-name.entity'
import { SoundDisplayNameService } from './sound-display-name.service'
import { SoundTag } from './sound-tag.entity'
import { SoundTagService } from './sound-tag.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([PlayerSnapshot, AppConfig, SoundTag, SoundDisplayName]),
  ],
  providers: [PlayerSnapshotService, AppConfigService, SoundTagService, SoundDisplayNameService],
  exports: [PlayerSnapshotService, AppConfigService, SoundTagService, SoundDisplayNameService],
})
export class PersistenceModule {}
