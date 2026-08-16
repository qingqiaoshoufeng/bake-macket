import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { MediaAssetPolicyService } from '../catalog/media-asset-policy.service.js';
import {
  type AppConfig,
  buildDataSourceOptions,
  validateEnvironment,
} from '../config/env.schema.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import { AuditLog } from '../database/entities/audit-log.entity.js';
import { Category } from '../database/entities/category.entity.js';
import { HomepageDraft } from '../database/entities/homepage-draft.entity.js';
import { HomepagePage } from '../database/entities/homepage-page.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { User } from '../database/entities/user.entity.js';
import { HomepageService } from './homepage.service.js';

const HOMEPAGE_DEMO_SEED_ENTITIES = [
  AdminUser,
  AuditLog,
  Category,
  HomepageDraft,
  HomepagePage,
  Product,
  User,
] as const;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: (raw) => ({ appEnv: validateEnvironment(raw ?? process.env) }),
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        ...buildDataSourceOptions(config.get('appEnv', { infer: true })),
        entities: [...HOMEPAGE_DEMO_SEED_ENTITIES],
        migrationsRun: false,
        autoLoadEntities: false,
      }),
    }),
    TypeOrmModule.forFeature([
      HomepagePage,
      HomepageDraft,
      Product,
      Category,
    ]),
    AuditModule,
  ],
  providers: [HomepageService, MediaAssetPolicyService],
})
export class HomepageDemoSeedModule {}
