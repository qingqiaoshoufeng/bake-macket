import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import { CatalogService } from './catalog.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

@Controller('admin/categories')
@UseGuards(JwtAdminGuard)
export class AdminCategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get() list() {
    return this.catalog.listCategories();
  }
  @Post() create(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(id, dto);
  }
  @Delete(':id') async remove(@Param('id') id: string) {
    await this.catalog.deleteCategory(id);
  }
}
