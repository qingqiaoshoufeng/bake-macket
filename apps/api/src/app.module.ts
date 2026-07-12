import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { envSchema } from './config/env.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';

/**
 * Application root module. Loads and validates environment variables once at
 * boot, exposes them under the {@link ConfigService} key `appEnv`, wires the
 * TypeORM data source and registers the health endpoint.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (raw) => {
        const { value, error } = envSchema.validate(raw ?? process.env, {
          abortEarly: false,
          stripUnknown: true,
        });
        if (error) {
          throw new Error(
            `Invalid environment configuration: ${error.message}`,
          );
        }
        return value;
      },
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    DatabaseModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
