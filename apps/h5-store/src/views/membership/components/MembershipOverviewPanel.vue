<script setup lang="ts">
import type { MembershipOverviewModel } from '../type/index.js';

defineProps<{ overview: MembershipOverviewModel }>();
const money = (cents: number): string => `¥${(cents / 100).toFixed(2)}`;
</script>

<template>
  <section class="membership-overview">
    <div>
      <small>AVAILABLE CREDIT</small>
      <strong>{{ money(overview.account.availableCreditCents) }}</strong>
      <span>可用消费金</span>
    </div>
    <div>
      <small>CURRENT PASS</small>
      <strong>{{ overview.currentMembership?.name ?? '尚未开通' }}</strong>
      <span>{{
        overview.currentMembership ? '会员权益生效中' : '挑选一张烘焙护照'
      }}</span>
    </div>
  </section>
</template>

<style scoped>
.membership-overview {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mall-space-3);
}
.membership-overview > div {
  min-width: 0;
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.membership-overview small,
.membership-overview strong,
.membership-overview span {
  display: block;
}
.membership-overview small {
  color: var(--mall-accent);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.11em;
}
.membership-overview strong {
  margin-top: var(--mall-space-2);
  overflow: hidden;
  font-family: Georgia, 'Songti SC', serif;
  font-size: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.membership-overview span {
  margin-top: var(--mall-space-1);
  color: var(--mall-text-muted);
  font-size: 11px;
}
</style>
