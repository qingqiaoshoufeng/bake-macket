import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module.js';
import { BannerModule } from './banner/banner.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { UploadModule } from './upload/upload.module.js';
import { envSchema } from './config/env.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';

/**
 * Application root module. Loads and validates environment variables once at
 * boot, exposes them under the {@link ConfigService} key `appEnv`, wires the
 * TypeORM data source, registers the health endpoint, and mounts the
 * authentication module that issues isolated user/admin JWTs.
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
        // Nest stores the validator return value under the `appEnv` key so
        // `config.get('appEnv', { infer: true })` resolves to the typed
        // AppEnv object.
        return { appEnv: value };
      },
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    DatabaseModule,
    AuthModule,
    CatalogModule,
    BannerModule,
    CustomerModule,
    OrdersModule,
    UploadModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
