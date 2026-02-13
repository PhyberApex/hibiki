import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayerSnapshot } from './player-snapshot.entity';
import { PlayerSnapshotService } from './player-snapshot.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlayerSnapshot])],
  providers: [PlayerSnapshotService],
  exports: [PlayerSnapshotService],
})
export class PersistenceModule {}
