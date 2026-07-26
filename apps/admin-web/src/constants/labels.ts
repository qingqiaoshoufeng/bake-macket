/**
 * Global admin labels (Task 12).
 *
 * Centralising the Chinese labels here means a future i18n swap touches a
 * single file. The labels are the user-facing copy that Element Plus
 * surfaces render across the catalog / product / banner / order views.
 */

import {
  BannerTargetType,
  FulfillmentType,
  MemberCreditDirection,
  MemberCreditEntryType,
  MemberCreditGrantStatus,
  MembershipEntitlementSegmentKind,
  MembershipPaymentChannel,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipStatus,
  OrderStatus,
} from '@bake-mall/contracts';

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  [OrderStatus.NEW]: '新订单',
  [OrderStatus.PROCESSING]: '处理中',
  [OrderStatus.COMPLETED]: '已完成',
  [OrderStatus.CANCELLED]: '已取消',
};

export const ORDER_STATUS_TAG_TYPE: Readonly<
  Record<OrderStatus, 'primary' | 'warning' | 'success' | 'info'>
> = {
  [OrderStatus.NEW]: 'primary',
  [OrderStatus.PROCESSING]: 'warning',
  [OrderStatus.COMPLETED]: 'success',
  [OrderStatus.CANCELLED]: 'info',
};

export const FULFILLMENT_LABELS: Readonly<Record<FulfillmentType, string>> = {
  [FulfillmentType.PICKUP]: '到店自提',
  [FulfillmentType.DELIVERY]: '同城配送',
};

export const BANNER_TARGET_LABELS: Readonly<Record<BannerTargetType, string>> =
  {
    [BannerTargetType.NONE]: '无跳转',
    [BannerTargetType.PRODUCT]: '跳转到商品',
    [BannerTargetType.CATEGORY]: '跳转到分类',
  };

export const MEMBERSHIP_PURCHASE_STATUS_LABELS: Readonly<
  Record<MembershipPurchaseStatus, string>
> = {
  [MembershipPurchaseStatus.PENDING]: '待履约',
  [MembershipPurchaseStatus.FULFILLED]: '已履约',
  [MembershipPurchaseStatus.VOIDED]: '已作废',
};

export const MEMBERSHIP_PAYMENT_STATUS_LABELS: Readonly<
  Record<MembershipPaymentStatus, string>
> = {
  [MembershipPaymentStatus.PENDING]: '待支付',
  [MembershipPaymentStatus.SUCCEEDED]: '支付成功',
  [MembershipPaymentStatus.REVERSED]: '已冲正',
};

export const MEMBERSHIP_PAYMENT_CHANNEL_LABELS: Readonly<
  Record<MembershipPaymentChannel, string>
> = {
  [MembershipPaymentChannel.SIMULATED]: '模拟支付',
};

export const MEMBERSHIP_STATUS_LABELS: Readonly<
  Record<MembershipStatus, string>
> = {
  [MembershipStatus.ACTIVE]: '生效中',
  [MembershipStatus.REPLACED]: '已替换',
  [MembershipStatus.VOIDED]: '已作废',
  [MembershipStatus.EXPIRED]: '已过期',
};

export const MEMBERSHIP_SEGMENT_KIND_LABELS: Readonly<
  Record<MembershipEntitlementSegmentKind, string>
> = {
  [MembershipEntitlementSegmentKind.INITIAL]: '首次开卡',
  [MembershipEntitlementSegmentKind.RENEWAL]: '同级续费',
  [MembershipEntitlementSegmentKind.UPGRADE]: '会员升级',
};

export const MEMBER_CREDIT_GRANT_STATUS_LABELS: Readonly<
  Record<MemberCreditGrantStatus, string>
> = {
  [MemberCreditGrantStatus.ACTIVE]: '可用',
  [MemberCreditGrantStatus.EXHAUSTED]: '已用完',
  [MemberCreditGrantStatus.REVERSED]: '已冲销',
};

export const MEMBER_CREDIT_DIRECTION_LABELS: Readonly<
  Record<MemberCreditDirection, string>
> = {
  [MemberCreditDirection.CREDIT]: '入账',
  [MemberCreditDirection.DEBIT]: '出账',
};

export const MEMBER_CREDIT_ENTRY_TYPE_LABELS: Readonly<
  Record<MemberCreditEntryType, string>
> = {
  [MemberCreditEntryType.MEMBERSHIP_PURCHASE_GRANT]: '购卡赠送',
  [MemberCreditEntryType.PRODUCT_ORDER_DEBIT]: '商品订单抵扣',
  [MemberCreditEntryType.PRODUCT_ORDER_CANCEL_REVERSAL]: '取消订单返还',
  [MemberCreditEntryType.MEMBERSHIP_PURCHASE_VOID_REVERSAL]: '购卡作废冲正',
};
