import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api');

  const config = app.get(ConfigService);
  const port = Number(process.env.PORT ?? config.get<number>('PORT') ?? 3000);
  await app.listen(port);
}
void bootstrap();
