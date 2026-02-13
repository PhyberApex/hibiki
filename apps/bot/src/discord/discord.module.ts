import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PlayerModule } from '../player/player.module';
import { SoundModule } from '../sound/sound.module';
import { DiscordService } from './discord.service';

@Module({
  imports: [ConfigModule, PlayerModule, SoundModule],
  providers: [DiscordService],
})
export class DiscordModule {}
