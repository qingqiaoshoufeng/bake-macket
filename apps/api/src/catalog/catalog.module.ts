import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { HtmlSanitizerService } from '../content/html-sanitizer.service.js';
import { Category } from '../database/entities/category.entity.js';
import { ProductImage } from '../database/entities/product-image.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { AdminCategoriesController } from './admin-categories.controller.js';
import { AdminProductsController } from './admin-products.controller.js';
import { CatalogService } from './catalog.service.js';
import { MediaAssetPolicyService } from './media-asset-policy.service.js';
import { PublicCatalogController } from './public-catalog.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category, Product, ProductImage, Sku]),
    AuthModule,
  ],
  controllers: [
    AdminCategoriesController,
    AdminProductsController,
    PublicCatalogController,
  ],
  providers: [CatalogService, HtmlSanitizerService, MediaAssetPolicyService],
  exports: [CatalogService],
})
export class CatalogModule {}
