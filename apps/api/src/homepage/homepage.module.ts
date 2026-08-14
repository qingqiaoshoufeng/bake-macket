import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaAssetPolicyService } from '../catalog/media-asset-policy.service.js';
import { Category } from '../database/entities/category.entity.js';
import { HomepageDraft } from '../database/entities/homepage-draft.entity.js';
import { HomepagePage } from '../database/entities/homepage-page.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { AdminHomepageDraftsController } from './admin-homepage-drafts.controller.js';
import { AdminHomepageController } from './admin-homepage.controller.js';
import { HomepageService } from './homepage.service.js';
import { PublicHomepageController } from './public-homepage.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([HomepagePage, HomepageDraft, Product, Category]),
    AuditModule,
    AuthModule,
  ],
  controllers: [
    AdminHomepageController,
    AdminHomepageDraftsController,
    PublicHomepageController,
  ],
  providers: [HomepageService, MediaAssetPolicyService],
})
export class HomepageModule {}
