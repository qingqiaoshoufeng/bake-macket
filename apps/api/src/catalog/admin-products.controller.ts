import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import type {
  AdminProductDetailView,
  AdminProductListResult,
  SaveProductRequest,
} from '@bake-mall/contracts';

import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { CatalogService } from './catalog.service.js';
import { AdminProductListQueryDto } from './dto/admin-product-list-query.dto.js';
import { UpdateProductDto } from './dto/product.dto.js';
import { SaveProductDto } from './dto/save-product.dto.js';
import { CreateSkuDto, UpdateSkuDto } from './dto/sku.dto.js';

@Controller('admin/products')
@UseGuards(JwtAdminGuard)
export class AdminProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(
    @Query() query: AdminProductListQueryDto,
  ): Promise<AdminProductListResult> {
    return this.catalog.listAdminProducts(query);
  }
  @Post() create(
    @Body() dto: SaveProductDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminProductDetailView> {
    return this.catalog.saveProductAggregate(
      null,
      dto as SaveProductRequest,
      admin.id,
    );
  }
  @Get(':id') getOne(@Param('id') id: string): Promise<AdminProductDetailView> {
    return this.catalog.getAdminProduct(id);
  }
  @Put(':id') replace(
    @Param('id') id: string,
    @Body() dto: SaveProductDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminProductDetailView> {
    return this.catalog.saveProductAggregate(
      id,
      dto as SaveProductRequest,
      admin.id,
    );
  }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, dto);
  }
  @Delete(':id') async remove(@Param('id') id: string) {
    await this.catalog.deleteProduct(id);
  }
  @Get(':id/skus') listSkus(@Param('id') productId: string) {
    return this.catalog.listSkus(productId);
  }
  @Post(':id/skus') createSku(
    @Param('id') productId: string,
    @Body() dto: CreateSkuDto,
  ) {
    return this.catalog.createSku(productId, dto);
  }
  @Patch(':id/skus/:skuId') updateSku(
    @Param('id') productId: string,
    @Param('skuId') skuId: string,
    @Body() dto: UpdateSkuDto,
  ) {
    return this.catalog.updateSku(productId, skuId, dto);
  }
  @Delete(':id/skus/:skuId') async removeSku(
    @Param('id') productId: string,
    @Param('skuId') skuId: string,
  ) {
    await this.catalog.deleteSku(productId, skuId);
  }
}
