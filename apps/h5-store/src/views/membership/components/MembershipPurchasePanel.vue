<script setup lang="ts">
import type {
  MembershipLevelModel,
  MembershipPurchaseCapability,
  MembershipPurchaseState,
} from '../type/index.js';

const props = defineProps<{
  level: MembershipLevelModel;
  capability: MembershipPurchaseCapability;
  state: MembershipPurchaseState;
  submitting: boolean;
  canSimulatePayment: boolean;
  isProduction: boolean;
}>();
defineEmits<{
  (event: 'purchase'): void;
  (event: 'simulate-payment'): void;
}>();

const money = (cents: number): string => `¥${(cents / 100).toFixed(2)}`;
const purchaseLabel = (): string =>
  props.submitting
    ? '处理中…'
    : `${props.capability.label} · ${money(props.level.priceCents)}`;
</script>

<template>
  <section class="purchase-panel">
    <div class="purchase-panel__summary">
      <span>有效期 {{ level.validDays }} 天</span>
      <span>赠 {{ money(level.grantCreditCents) }} 消费金</span>
    </div>
    <p>{{ capability.description }}</p>
    <button
      v-if="!isProduction && (state.kind === 'idle' || state.kind === 'failed')"
      type="button"
      class="purchase-panel__primary"
      data-testid="purchase"
      :disabled="!capability.allowed || submitting"
      @click="$emit('purchase')"
    >
      {{ purchaseLabel() }}
    </button>
    <button
      v-if="!isProduction && canSimulatePayment"
      type="button"
      class="purchase-panel__simulate"
      :disabled="submitting"
      data-testid="simulate-payment"
      @click="$emit('simulate-payment')"
    >
      {{ submitting ? '模拟支付中…' : '开发环境 · 模拟支付并开通' }}
    </button>
    <p
      v-if="isProduction && state.kind !== 'fulfilled'"
      class="purchase-panel__closed"
    >
      购买暂未开放，请稍后再来。
    </p>
    <p
      v-if="state.message"
      class="purchase-panel__state"
      :data-kind="state.kind"
    >
      {{ state.message }}
    </p>
  </section>
</template>

<style scoped>
.purchase-panel {
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-floating);
}
.purchase-panel__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mall-space-2);
  color: var(--mall-primary-strong);
  font-size: 12px;
  font-weight: 700;
}
.purchase-panel > p {
  margin: var(--mall-space-2) 0 0;
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.purchase-panel button {
  width: 100%;
  min-height: 48px;
  margin-top: var(--mall-space-3);
  border-radius: var(--mall-radius-control);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.purchase-panel__primary {
  border: 0;
  background: var(--mall-primary);
  color: #fff;
}
.purchase-panel__simulate {
  border: 1px dashed var(--mall-warning);
  background: color-mix(in srgb, var(--mall-warning) 10%, white);
  color: #8a5b28;
}
.purchase-panel button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}
.purchase-panel button:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--mall-accent) 50%, transparent);
  outline-offset: 2px;
}
.purchase-panel__state[data-kind='failed'] {
  color: var(--mall-danger);
}
.purchase-panel__state[data-kind='fulfilled'] {
  color: var(--mall-success);
}
.purchase-panel__closed {
  color: var(--mall-warning) !important;
  font-weight: 700;
}
</style>
