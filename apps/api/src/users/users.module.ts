import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { Address } from '../database/entities/address.entity.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import { CartItem } from '../database/entities/cart-item.entity.js';
import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MemberCreditAllocation } from '../database/entities/member-credit-allocation.entity.js';
import { MemberCreditEntry } from '../database/entities/member-credit-entry.entity.js';
import { MemberCreditGrant } from '../database/entities/member-credit-grant.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { User } from '../database/entities/user.entity.js';
import { WechatCredentialUse } from '../database/entities/wechat-credential-use.entity.js';
import { UserIdentityMergeService } from './user-identity-merge.service.js';
import { UserIdentityService } from './user-identity.service.js';
import { WechatPhoneCredentialService } from './wechat-phone-credential.service.js';

@Module({
  imports: [
    AuditModule,
    TypeOrmModule.forFeature([
      User,
      AdminUser,
      Address,
      CartItem,
      Order,
      MembershipPurchaseOrder,
      UserMembership,
      MemberAccount,
      MemberCreditEntry,
      MemberCreditGrant,
      MemberCreditAllocation,
      WechatCredentialUse,
    ]),
  ],
  providers: [
    UserIdentityService,
    UserIdentityMergeService,
    WechatPhoneCredentialService,
  ],
  exports: [
    UserIdentityService,
    UserIdentityMergeService,
    WechatPhoneCredentialService,
  ],
})
export class UsersModule {}
