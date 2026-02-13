import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

function ensureStorageDirs() {
  const dbPath = resolve(
    process.cwd(),
    process.env.HIBIKI_DB_PATH ?? 'storage/data/hibiki.sqlite',
  );
  mkdirSync(dirname(dbPath), { recursive: true });
}

async function bootstrap() {
  ensureStorageDirs();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api');

  const config = app.get(ConfigService);
  const port = Number(process.env.PORT ?? config.get<number>('PORT') ?? 3000);
  await app.listen(port);
}
void bootstrap();
