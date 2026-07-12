import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Banner } from '../database/entities/banner.entity.js';
import { Category } from '../database/entities/category.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { AdminBannerController } from './admin-banner.controller.js';
import { BannerService } from './banner.service.js';
import { PublicBannerController } from './public-banner.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Banner, Product, Category])],
  controllers: [AdminBannerController, PublicBannerController],
  providers: [BannerService],
})
export class BannerModule {}
