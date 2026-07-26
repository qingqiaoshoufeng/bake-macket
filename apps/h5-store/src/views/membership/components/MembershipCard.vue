<script setup lang="ts">
import type { MembershipCarouselItem } from '../type/index.js';
import { MEMBERSHIP_THEME_CLASS } from '../config/copy.js';

defineProps<{
  item: MembershipCarouselItem;
  availableCreditCents: number;
  endsAt?: string;
}>();
defineEmits<{ (event: 'open', id: string): void }>();

const money = (cents: number | null): string =>
  cents === null ? '暂不可购' : `¥${(cents / 100).toFixed(2)}`;
const discount = (basisPoints: number): string =>
  `${(basisPoints / 1000).toFixed(basisPoints % 1000 ? 1 : 0)} 折`;
const date = (value?: string): string =>
  value
    ? new Intl.DateTimeFormat('zh-CN').format(new Date(value))
    : '开通后生效';
</script>

<template>
  <button
    type="button"
    class="membership-card"
    :class="MEMBERSHIP_THEME_CLASS[item.level.cardTheme.theme]"
    data-testid="membership-card"
    :aria-label="`${item.level.name}，${item.capability.label}${item.purchasable ? '，查看详情' : ''}`"
    :disabled="!item.purchasable"
    @click="$emit('open', item.level.id)"
  >
    <span class="membership-card__glow" aria-hidden="true" />
    <span class="membership-card__head">
      <span>
        <small>BAKE PASSPORT</small>
        <strong>{{ item.level.name }}</strong>
      </span>
      <em>{{ item.level.cardTheme.badgeText }}</em>
    </span>
    <span class="membership-card__status">
      {{
        item.purchasable
          ? item.isCurrent
            ? `有效至 ${date(endsAt)}`
            : item.capability.description
          : `${item.capability.description} · 有效至 ${date(endsAt)}`
      }}
    </span>
    <span class="membership-card__stats">
      <span
        ><small>会员折扣</small
        ><strong>{{ discount(item.level.discountBasisPoints) }}</strong></span
      >
      <span
        ><small>消费金</small
        ><strong>{{
          money(
            item.isCurrent ? availableCreditCents : item.level.grantCreditCents,
          )
        }}</strong></span
      >
      <span
        ><small>会籍价格</small
        ><strong>{{ money(item.level.priceCents) }}</strong></span
      >
    </span>
    <span class="membership-card__benefits">
      {{
        item.level.benefits
          .slice(0, 2)
          .map((benefit) => benefit.title)
          .join(' · ') || '更多烘焙权益即将解锁'
      }}
    </span>
    <span
      class="membership-card__action"
      :class="{ 'is-blocked': !item.capability.allowed }"
    >
      {{ item.capability.label }} <span aria-hidden="true">→</span>
    </span>
  </button>
</template>

<style scoped>
.membership-card {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 248px;
  padding: 22px;
  overflow: hidden;
  flex-direction: column;
  border: 0;
  border-radius: 26px;
  background: linear-gradient(145deg, #f8f2e8, #d9e6d7);
  color: #314037;
  box-shadow: 0 18px 38px rgb(50 75 57 / 18%);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.membership-card--champagne {
  background: linear-gradient(145deg, #fff3d9, #e8c98f);
}
.membership-card--jade {
  background: linear-gradient(145deg, #e4f2e5, #9fc5a6);
}
.membership-card--obsidian {
  background: linear-gradient(145deg, #3d4b43, #1d2922);
  color: #f7f3e8;
}
.membership-card__glow {
  position: absolute;
  top: -70px;
  right: -45px;
  width: 180px;
  height: 180px;
  border: 1px solid rgb(255 255 255 / 36%);
  border-radius: 50%;
  box-shadow: 0 0 0 24px rgb(255 255 255 / 8%);
}
.membership-card__head,
.membership-card__stats {
  position: relative;
  display: flex;
  justify-content: space-between;
  gap: var(--mall-space-2);
}
.membership-card__head small,
.membership-card__head strong,
.membership-card__stats small,
.membership-card__stats strong {
  display: block;
}
.membership-card__head small {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.16em;
  opacity: 0.72;
}
.membership-card__head strong {
  margin-top: 4px;
  font-family: Georgia, 'Songti SC', serif;
  font-size: 25px;
  letter-spacing: 0.08em;
}
.membership-card__head em {
  align-self: flex-start;
  padding: 5px 10px;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 11px;
  font-style: normal;
  opacity: 0.8;
}
.membership-card__status {
  position: relative;
  margin-top: var(--mall-space-2);
  font-size: 12px;
  opacity: 0.76;
}
.membership-card__stats {
  margin-top: auto;
  padding-top: var(--mall-space-5);
}
.membership-card__stats > span {
  min-width: 0;
}
.membership-card__stats small {
  font-size: 10px;
  opacity: 0.68;
}
.membership-card__stats strong {
  margin-top: 3px;
  font-size: 14px;
}
.membership-card__benefits {
  margin-top: var(--mall-space-3);
  overflow: hidden;
  font-size: 11px;
  opacity: 0.76;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.membership-card__action {
  display: flex;
  min-height: 44px;
  margin-top: var(--mall-space-2);
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgb(255 255 255 / 36%);
  font-size: 13px;
  font-weight: 800;
}
.membership-card__action.is-blocked {
  opacity: 0.58;
}
.membership-card:disabled {
  cursor: default;
}
.membership-card:focus-visible {
  outline: 4px solid color-mix(in srgb, var(--mall-accent) 72%, white);
  outline-offset: 3px;
}
@media (max-width: 360px) {
  .membership-card {
    padding: 18px;
  }
  .membership-card__stats strong {
    font-size: 13px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .membership-card {
    scroll-behavior: auto;
  }
}
</style>
