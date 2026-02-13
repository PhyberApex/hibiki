import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ServeStaticModule } from '@nestjs/serve-static'
import { TypeOrmModule } from '@nestjs/typeorm'
import { resolve } from 'path'
import { AppController } from './app.controller'
import { configuration } from './config/configuration'
import { validationSchema } from './config/validation'
import { SoundModule } from './sound/sound.module'
import { PlayerModule } from './player/player.module'
import { DiscordModule } from './discord/discord.module'
import { PersistenceModule } from './persistence/persistence.module'
import { PlayerSnapshot } from './persistence/player-snapshot.entity'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validationSchema }),
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const distDir = config.get<string>('audio.webDistDir', 'apps/bot/web-dist')
        return [
          {
            rootPath: resolve(process.cwd(), distDir),
            exclude: ['/api*'],
          },
        ]
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'sqlite',
        database: resolve(process.cwd(), config.get<string>('database.path', 'storage/data/hibiki.sqlite')),
        entities: [PlayerSnapshot],
        synchronize: true,
      }),
    }),
    PersistenceModule,
    SoundModule,
    PlayerModule,
    DiscordModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
