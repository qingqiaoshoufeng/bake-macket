import { Controller, Get, Param, Query } from '@nestjs/common';

import { CatalogService } from './catalog.service.js';
import { PublicProductsQueryDto } from './dto/public-products-query.dto.js';

@Controller('public')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories') listCategories() {
    return this.catalog.listPublicCategories();
  }
  @Get('products') listProducts(@Query() query: PublicProductsQueryDto) {
    return this.catalog.listPublicProducts(query);
  }
  @Get('products/:id') product(@Param('id') id: string) {
    return this.catalog.getPublicProduct(id);
  }
}
