import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { configuration } from './config/configuration';
import { validationSchema } from './config/validation';
import { SoundModule } from './sound/sound.module';
import { PlayerModule } from './player/player.module';
import { DiscordModule } from './discord/discord.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validationSchema }),
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const distDir = config.get<string>('audio.webDistDir', 'apps/bot/web-dist');
        return [
          {
            rootPath: resolve(process.cwd(), distDir),
            exclude: ['/api*'],
          },
        ];
      },
    }),
    SoundModule,
    PlayerModule,
    DiscordModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
