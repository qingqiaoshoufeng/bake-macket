import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import { BannerService } from './banner.service.js';
import { CreateBannerDto, UpdateBannerDto } from './dto.js';

@Controller('admin/banners')
@UseGuards(JwtAdminGuard)
export class AdminBannerController {
  constructor(private readonly banners: BannerService) {}

  @Get()
  list() {
    return this.banners.list();
  }

  @Post()
  create(@Body() dto: CreateBannerDto) {
    return this.banners.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.banners.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.banners.remove(id);
  }
}
