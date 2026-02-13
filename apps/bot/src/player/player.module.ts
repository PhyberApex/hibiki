import { Module } from '@nestjs/common';
import { PermissionGuard } from '../permissions/guard';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';
import { SoundModule } from '../sound/sound.module';
import { DiscordModule } from '../discord/discord.module';

@Module({
  imports: [SoundModule, DiscordModule],
  providers: [PlayerService],
  controllers: [PlayerController],
  exports: [PlayerService],
})
export class PlayerModule {}
