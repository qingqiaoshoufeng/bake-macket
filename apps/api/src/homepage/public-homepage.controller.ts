import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { PublicHomepageView } from '@bake-mall/contracts';

import { HomepageService } from './homepage.service.js';

@Controller('public/homepage')
export class PublicHomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get()
  async get(@Res() response: Response): Promise<void> {
    const view: PublicHomepageView | null = await this.homepage.getPublicView();
    response.status(200).json(view);
  }
}
