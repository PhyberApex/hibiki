import { Module } from '@nestjs/common'
import { PlayerService } from './player.service'
import { PlayerController } from './player.controller'
import { SoundModule } from '../sound/sound.module'
import { DiscordModule } from '../discord/discord.module'
import { PermissionsModule } from '../permissions'

@Module({
  imports: [SoundModule, DiscordModule, PermissionsModule],
  providers: [PlayerService],
  controllers: [PlayerController],
  exports: [PlayerService],
})
export class PlayerModule {}
