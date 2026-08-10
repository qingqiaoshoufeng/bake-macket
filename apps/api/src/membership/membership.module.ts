import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { type AppConfig } from '../config/env.schema.js';
import { CartItem } from '../database/entities/cart-item.entity.js';
import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MemberCreditAllocation } from '../database/entities/member-credit-allocation.entity.js';
import { MemberCreditEntry } from '../database/entities/member-credit-entry.entity.js';
import { IdempotencyRecord } from '../database/entities/idempotency-record.entity.js';
import { MemberCreditGrant } from '../database/entities/member-credit-grant.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { MembershipEntitlementSegment } from '../database/entities/membership-entitlement-segment.entity.js';
import { MembershipLevel } from '../database/entities/membership-level.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { User } from '../database/entities/user.entity.js';
import { AdminMembershipController } from './admin-membership.controller.js';
import { AdminMembershipPurchasesController } from './admin-membership-purchases.controller.js';
import { CustomerMembershipController } from './customer-membership.controller.js';
import {
  MEMBERSHIP_CLOCK,
  MembershipPricingService,
} from './membership-pricing.service.js';
import {
  MEMBERSHIP_PURCHASE_CLOCK,
  MembershipPurchaseService,
} from './membership-purchase.service.js';
import { OrderQuoteController } from './order-quote.controller.js';
import { OrderQuoteTokenService } from './order-quote-token.service.js';
import { MembershipService } from './membership.service.js';
import { MembershipCreditService } from './membership-credit.service.js';
import { MembershipEntitlementService } from './membership-entitlement.service.js';
import { PublicMembershipController } from './public-membership.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MembershipLevel,
      MembershipPurchaseOrder,
      CartItem,
      Sku,
      Product,
      MemberAccount,
      UserMembership,
      MembershipEntitlementSegment,
      MemberCreditGrant,
      MemberCreditEntry,
      MemberCreditAllocation,
      IdempotencyRecord,
      Order,
      User,
    ]),
    AuditModule,
    AuthModule,
  ],
  controllers: [
    AdminMembershipController,
    AdminMembershipPurchasesController,
    CustomerMembershipController,
    PublicMembershipController,
    OrderQuoteController,
  ],
  providers: [
    MembershipService,
    MembershipCreditService,
    MembershipEntitlementService,
    MembershipPurchaseService,
    MembershipPricingService,
    { provide: MEMBERSHIP_PURCHASE_CLOCK, useValue: () => new Date() },
    { provide: MEMBERSHIP_CLOCK, useValue: () => new Date() },
    {
      provide: OrderQuoteTokenService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const env = config.get('appEnv', { infer: true });
        return new OrderQuoteTokenService(
          env.ORDER_QUOTE_TOKEN_SECRET,
          env.ORDER_QUOTE_TTL_SECONDS,
        );
      },
    },
  ],
  exports: [
    MembershipService,
    MembershipCreditService,
    MembershipPricingService,
    OrderQuoteTokenService,
  ],
})
export class MembershipModule {}
