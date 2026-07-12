import { Controller, Get } from '@nestjs/common';

import { BannerService } from './banner.service.js';

@Controller('public/banners')
export class PublicBannerController {
  constructor(private readonly banners: BannerService) {}

  @Get()
  list() {
    return this.banners.listPublic();
  }
}
