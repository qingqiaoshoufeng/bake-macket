import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { MediaAssetPolicyService } from '../catalog/media-asset-policy.service.js';
import { Category } from '../database/entities/category.entity.js';
import { HomepagePage } from '../database/entities/homepage-page.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { AdminHomepageController } from './admin-homepage.controller.js';
import { HomepageService } from './homepage.service.js';
import { PublicHomepageController } from './public-homepage.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([HomepagePage, Product, Category]), AuditModule],
  controllers: [AdminHomepageController, PublicHomepageController],
  providers: [HomepageService, MediaAssetPolicyService],
})
export class HomepageModule {}
