import { Controller, Get, Param, Query } from '@nestjs/common';

import type {
  PublicProductDetailView,
  PublicProductSummaryView,
} from '@bake-mall/contracts';

import { CatalogService } from './catalog.service.js';
import { PublicProductsQueryDto } from './dto/public-products-query.dto.js';

@Controller('public')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories') listCategories() {
    return this.catalog.listPublicCategories();
  }
  @Get('products') listProducts(
    @Query() query: PublicProductsQueryDto,
  ): Promise<PublicProductSummaryView[]> {
    return this.catalog.listPublicProducts(query);
  }
  @Get('products/:id') product(
    @Param('id') id: string,
  ): Promise<PublicProductDetailView> {
    return this.catalog.getPublicProduct(id);
  }
}
