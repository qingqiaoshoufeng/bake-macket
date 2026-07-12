import { describe, expect, it } from 'vitest';

import { OrderStatus } from './enums.js';
import { canTransitionOrder } from './order.js';

describe('canTransitionOrder', () => {
  it('allows only the specified order transitions', () => {
    expect(canTransitionOrder(OrderStatus.NEW, OrderStatus.PROCESSING)).toBe(
      true,
    );
    expect(
      canTransitionOrder(OrderStatus.PROCESSING, OrderStatus.COMPLETED),
    ).toBe(true);
    expect(
      canTransitionOrder(OrderStatus.PROCESSING, OrderStatus.CANCELLED),
    ).toBe(true);
    expect(canTransitionOrder(OrderStatus.NEW, OrderStatus.COMPLETED)).toBe(
      false,
    );
    expect(
      canTransitionOrder(OrderStatus.COMPLETED, OrderStatus.PROCESSING),
    ).toBe(false);
  });
});
