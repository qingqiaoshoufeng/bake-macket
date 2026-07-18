import { computed, type ComputedRef } from 'vue';

import {
  canTransitionOrder,
  OrderStatus,
  type OrderStatus as OrderStatusType,
  type OrderView,
} from '@bake-mall/contracts';

import { adminOrdersApi } from '../../../api/orders.js';

/**
 * Pure derivation: which status transitions are legal for the given
 * order right now. The shared {@link canTransitionOrder} predicate is
 * the single source of truth; the admin UI just decorates the result
 * with Chinese labels so the presentational component stays free of
 * business knowledge.
 */
export type OrderAction = {
  readonly key: 'start' | 'complete' | 'cancel';
  readonly status: OrderStatusType;
  readonly label: string;
  readonly description: string;
};

const ACTION_DEFINITIONS: Readonly<
  Record<OrderAction['key'], Omit<OrderAction, 'key'>>
> = {
  start: {
    status: OrderStatus.PROCESSING,
    label: '开始处理',
    description: '将订单状态从“待处理”切换为“处理中”,准备安排生产或发货。',
  },
  complete: {
    status: OrderStatus.COMPLETED,
    label: '完成订单',
    description: '订单已交付,标记为已完成。',
  },
  cancel: {
    status: OrderStatus.CANCELLED,
    label: '取消订单',
    description: '取消订单不会回补库存,请确认后再操作。',
  },
};

export type UseOrderActionsResult = {
  readonly actions: ComputedRef<readonly OrderAction[]>;
  readonly canStart: ComputedRef<boolean>;
  readonly canComplete: ComputedRef<boolean>;
  readonly canCancel: ComputedRef<boolean>;
};

export function useOrderActions(order: () => OrderView): UseOrderActionsResult {
  const actions = computed<readonly OrderAction[]>(() => {
    const current = order().status;
    return (Object.keys(ACTION_DEFINITIONS) as Array<OrderAction['key']>)
      .filter((key) =>
        canTransitionOrder(current, ACTION_DEFINITIONS[key].status),
      )
      .map((key) => ({ key, ...ACTION_DEFINITIONS[key] }));
  });

  const canStart = computed(() =>
    canTransitionOrder(order().status, OrderStatus.PROCESSING),
  );
  const canComplete = computed(() =>
    canTransitionOrder(order().status, OrderStatus.COMPLETED),
  );
  const canCancel = computed(() =>
    canTransitionOrder(order().status, OrderStatus.CANCELLED),
  );

  return { actions, canStart, canComplete, canCancel };
}

export type UpdateStatusInput = {
  readonly orderId: string;
  readonly status: OrderStatusType;
};

export async function applyOrderStatusUpdate(
  input: UpdateStatusInput,
): Promise<OrderView> {
  return adminOrdersApi.updateStatus(input.orderId, { status: input.status });
}
