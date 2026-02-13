import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PermissionsModule } from '../permissions';
import { PersistenceModule } from '../persistence/persistence.module';
import { PlayerController } from '../player/player.controller';
import { PlayerService } from '../player/player.service';
import { SoundModule } from '../sound/sound.module';
import { DiscordService } from './discord.service';

/**
 * Single module for the bot: Discord client + player (playback state + REST API).
 * Keeps Discord and player in one place so we avoid circular module dependencies.
 */
@Module({
  imports: [
    ConfigModule,
    SoundModule,
    PermissionsModule,
    PersistenceModule,
  ],
  providers: [DiscordService, PlayerService],
  controllers: [PlayerController],
  exports: [DiscordService, PlayerService],
})
export class DiscordModule {}
