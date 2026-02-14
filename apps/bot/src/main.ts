import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

const logger = new Logger('Bootstrap');

function ensureStorageDirs() {
  const dbPath = resolve(
    process.cwd(),
    process.env.HIBIKI_DB_PATH ?? 'storage/data/hibiki.sqlite',
  );
  mkdirSync(dirname(dbPath), { recursive: true });
  logger.log(`Storage dirs ensured (DB: ${dbPath})`);
}

async function bootstrap() {
  ensureStorageDirs();
  logger.log('Creating Nest application');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api');
  logger.log('API prefix: /api');

  const config = app.get(ConfigService);
  const port = Number(process.env.PORT ?? config.get<number>('PORT') ?? 3000);
  await app.listen(port);
  logger.log(`Hibiki API listening on port ${port}`);
}
void bootstrap();
