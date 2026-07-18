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
