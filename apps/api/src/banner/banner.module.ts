import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { MediaAssetPolicyService } from '../catalog/media-asset-policy.service.js';
import { Banner } from '../database/entities/banner.entity.js';
import { Category } from '../database/entities/category.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { AdminBannerController } from './admin-banner.controller.js';
import { BannerService } from './banner.service.js';
import { PublicBannerController } from './public-banner.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Banner, Product, Category]), AuditModule],
  controllers: [AdminBannerController, PublicBannerController],
  providers: [BannerService, MediaAssetPolicyService],
})
export class BannerModule {}
