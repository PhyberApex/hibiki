import { resolve } from 'node:path'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ServeStaticModule } from '@nestjs/serve-static'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AppController } from './app.controller'
import { configuration } from './config/configuration'
import { validationSchema } from './config/validation'
import { DiscordModule } from './discord/discord.module'
import { AppConfig } from './persistence/app-config.entity'
import { PersistenceModule } from './persistence/persistence.module'
import { PlayerSnapshot } from './persistence/player-snapshot.entity'
import { SoundTag } from './persistence/sound-tag.entity'
import { SoundModule } from './sound/sound.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      envFilePath: [
        resolve(__dirname, '../../../.env'), // repo root (e.g. pnpm dev)
        resolve(process.cwd(), '.env'),
      ],
    }),
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const botRoot = resolve(__dirname, '..')
        const distDir = config.get<string>('audio.webDistDir', 'web-dist')
        return [
          {
            rootPath: resolve(botRoot, distDir),
            exclude: ['/api*'],
          },
        ]
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'sqlite',
        database: resolve(
          process.cwd(),
          config.get<string>('database.path', 'storage/data/hibiki.sqlite'),
        ),
        entities: [PlayerSnapshot, AppConfig, SoundTag],
        synchronize: true,
      }),
    }),
    PersistenceModule,
    SoundModule,
    DiscordModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
