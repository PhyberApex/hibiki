import { Module } from '@nestjs/common';
import { PermissionGuard } from '../permissions/guard';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';
import { SoundModule } from '../sound/sound.module';

@Module({
  imports: [SoundModule],
  providers: [PlayerService],
  controllers: [PlayerController],
  exports: [PlayerService],
})
export class PlayerModule {}
