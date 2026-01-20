import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';
import { enableProxyFromEnv } from './shared/network/proxy';

async function bootstrap() {
  enableProxyFromEnv();
  const app = await NestFactory.create(AppModule);
  app.use('/static', express.static(join(process.cwd(), 'public')));
  await app.listen(process.env.PORT ?? 3011);
}
void bootstrap();
