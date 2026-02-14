import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from './app-config.entity';
import { AppConfigService } from './app-config.service';
import { PlayerSnapshot } from './player-snapshot.entity';
import { PlayerSnapshotService } from './player-snapshot.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlayerSnapshot, AppConfig]),
  ],
  providers: [PlayerSnapshotService, AppConfigService],
  exports: [PlayerSnapshotService, AppConfigService],
})
export class PersistenceModule {}
