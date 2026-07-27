<script setup lang="ts">
import type {
  MemberCreditEntryView,
  MembershipPurchaseView,
} from '@bake-mall/contracts';

defineProps<{
  purchases: readonly MembershipPurchaseView[];
  creditEntries: readonly MemberCreditEntryView[];
}>();
const money = (cents: number): string => `¥${(cents / 100).toFixed(2)}`;
const date = (value: string): string =>
  new Intl.DateTimeFormat('zh-CN').format(new Date(value));
</script>

<template>
  <section class="membership-activity">
    <h2>最近消费金流水</h2>
    <ul v-if="creditEntries.length">
      <li v-for="entry in creditEntries.slice(0, 3)" :key="entry.id">
        <span>{{ date(entry.createdAt) }}</span>
        <strong
          >{{ entry.direction === 'CREDIT' ? '+' : '-'
          }}{{ money(entry.amountCents) }}</strong
        >
      </li>
    </ul>
    <p v-else>暂无消费金变化，购卡赠送与订单抵扣会记录在这里。</p>
    <div v-if="purchases[0]" class="membership-activity__purchase">
      <span>最近购卡</span>
      <strong
        >{{ purchases[0].levelName }} · {{ purchases[0].purchaseNo }}</strong
      >
    </div>
  </section>
</template>

<style scoped>
.membership-activity {
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.membership-activity h2,
.membership-activity p,
.membership-activity ul {
  margin: 0;
}
.membership-activity h2 {
  font-size: 15px;
}
.membership-activity p {
  margin-top: var(--mall-space-3);
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.6;
}
.membership-activity ul {
  display: grid;
  margin-top: var(--mall-space-2);
  padding: 0;
  list-style: none;
}
.membership-activity li,
.membership-activity__purchase {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: var(--mall-space-2);
  border-bottom: 1px solid var(--mall-border);
  font-size: 12px;
}
.membership-activity li span,
.membership-activity__purchase span {
  color: var(--mall-text-muted);
}
.membership-activity__purchase {
  margin-top: var(--mall-space-2);
  border-bottom: 0;
}
.membership-activity__purchase strong {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
