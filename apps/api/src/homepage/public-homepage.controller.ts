import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import type { PublicHomepageView } from '@bake-mall/contracts';

import type { AppConfig } from '../config/env.schema.js';
import { HomepageService } from './homepage.service.js';

@Controller('public/homepage')
export class PublicHomepageController {
  constructor(
    private readonly homepage: HomepageService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Get()
  async get(@Res() response: Response): Promise<void> {
    const env = this.config.get('appEnv', { infer: true });
    const view: PublicHomepageView | null = await this.homepage.getPublicView(env);
    response.status(200).json(view);
  }
}
