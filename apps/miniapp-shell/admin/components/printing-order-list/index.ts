import type { PrintingOrderRow } from '../../type/printing-orders.js';

Component({
  properties: {
    orders: {
      type: Array,
      value: [] as PrintingOrderRow[],
    },
    disabled: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    onToggle(event: WechatMiniprogram.TouchEvent): void {
      const orderId = event.currentTarget.dataset.orderId;
      if (typeof orderId !== 'string' || this.properties.disabled) return;
      this.triggerEvent('toggle', { orderId });
    },
  },
});
