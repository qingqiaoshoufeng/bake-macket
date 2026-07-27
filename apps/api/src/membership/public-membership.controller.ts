import { Controller, Get, Param } from '@nestjs/common';

import type { PublicMembershipLevelView } from '@bake-mall/contracts';

import { MembershipService } from './membership.service.js';

@Controller('public/membership-levels')
export class PublicMembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get()
  list(): Promise<PublicMembershipLevelView[]> {
    return this.membership.listPublicLevels();
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<PublicMembershipLevelView> {
    return this.membership.getPublicLevel(id);
  }
}
