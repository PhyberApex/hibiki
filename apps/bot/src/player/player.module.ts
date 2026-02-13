import { Module } from '@nestjs/common';
import { PermissionGuard } from '../permissions/guard';
import { PlayerService } from './player.service';
import { SoundModule } from '../sound/sound.module';

@Module({
  imports: [SoundModule],
  providers: [PlayerService],
  exports: [PlayerService],
})
export class PlayerModule {}
