import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { type AppConfig } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
  });

  // Global prefix scopes every public route under `/api/v1`. The health probe
  // is mapped explicitly to its full path on its controller, so it is excluded
  // here to prevent Nest from prepending the prefix a second time.
  app.setGlobalPrefix('api/v1', {
    exclude: ['api/v1/health'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const { PORT: port, HOST: host } = config.get('appEnv', { infer: true });

  await app.listen(port, host);

  Logger.log(
    `API listening on http://${host}:${port}/api/v1 (health: /api/v1/health)`,
    'Bootstrap',
  );
}

void bootstrap();
