import { computed } from 'vue';

import { useCartStore } from '../../../stores/cart.js';

export function useCartSummary() {
  const cart = useCartStore();
  const totalCents = computed(() =>
    cart.availableItems.reduce(
      (sum, item) => sum + item.sku.priceCents * item.quantity,
      0,
    ),
  );
  const itemCount = computed(() =>
    cart.availableItems.reduce((sum, item) => sum + item.quantity, 0),
  );
  return { cart, totalCents, itemCount };
}
