<script setup lang="ts">
import { MembershipTheme } from '@bake-mall/contracts';
import { computed } from 'vue';

import { MEMBERSHIP_THEME_OPTIONS } from '../config/themes.js';

const props = defineProps<{
  readonly name: string;
  readonly subtitle?: string;
  readonly badgeText: string;
  readonly theme: MembershipTheme;
  readonly discountText: string;
  readonly priceYuan: string;
  readonly grantCreditYuan: string;
  readonly validDays: number;
  readonly compact?: boolean;
}>();

const themeName = computed(
  () =>
    MEMBERSHIP_THEME_OPTIONS.find(({ value }) => value === props.theme)
      ?.recipeName ?? props.theme,
);
const accessibleLabel = computed(
  () =>
    `${props.name || '未命名会员卡'}，${props.discountText || '—'} 折，` +
    `售价 ${props.priceYuan || '0.00'} 元，赠送 ${props.grantCreditYuan || '0.00'} 元`,
);
</script>

<template>
  <article
    class="membership-card-preview"
    :class="{ 'membership-card-preview--compact': compact }"
    :data-theme="theme"
    :aria-label="accessibleLabel"
  >
    <div class="membership-card-preview__grain" aria-hidden="true"></div>
    <header class="membership-card-preview__head">
      <span>{{ themeName }}</span>
      <strong>{{ badgeText || 'BAKER CLUB' }}</strong>
    </header>

    <div class="membership-card-preview__body">
      <p>{{ subtitle || '给每一炉出品，留一份会员好味道' }}</p>
      <h3>{{ name || '未命名会员卡' }}</h3>
      <div class="membership-card-preview__measure">
        <strong>{{ discountText || '—' }} 折</strong>
        <span>¥{{ priceYuan || '0.00' }}</span>
      </div>
    </div>

    <footer class="membership-card-preview__foot">
      <span>赠 ¥{{ grantCreditYuan || '0.00' }}</span>
      <span data-testid="recipe-stamp"
        >{{ validDays }} DAYS · HOUSE RECIPE</span
      >
    </footer>
  </article>
</template>

<style scoped>
.membership-card-preview {
  --card-ink: #4a4250;
  --card-muted: #746b78;
  --card-paper: #f9f6f0;
  --card-wash: #efe8f0;
  --card-stamp: #7965b8;
  --card-rule: rgb(74 66 80 / 22%);

  position: relative;
  display: grid;
  width: min(100%, 480px);
  min-height: 268px;
  padding: 22px;
  overflow: hidden;
  border: 1px solid var(--card-rule);
  border-radius: 24px 12px 24px 12px;
  background:
    linear-gradient(135deg, rgb(255 255 255 / 72%), transparent 45%),
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 27px,
      rgb(74 66 80 / 5%) 28px
    ),
    var(--card-paper);
  box-shadow: 0 20px 45px rgb(73 57 105 / 15%);
  color: var(--card-ink);
  isolation: isolate;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease;
}

.membership-card-preview[data-theme='PEARL'] {
  --card-ink: #4d4652;
  --card-muted: #7b7180;
  --card-paper: #fffaf4;
  --card-wash: #eee7ee;
  --card-stamp: #987f9f;
  --card-rule: rgb(116 94 122 / 24%);
}

.membership-card-preview[data-theme='CHAMPAGNE'] {
  --card-ink: #5b432d;
  --card-muted: #856a4d;
  --card-paper: #fff8e9;
  --card-wash: #f0d7aa;
  --card-stamp: #9a6725;
  --card-rule: rgb(132 91 39 / 28%);
}

.membership-card-preview[data-theme='JADE'] {
  --card-ink: #244b3e;
  --card-muted: #527465;
  --card-paper: #eef7ef;
  --card-wash: #bcd9c6;
  --card-stamp: #2f6d56;
  --card-rule: rgb(42 98 77 / 25%);
}

.membership-card-preview[data-theme='OBSIDIAN'] {
  --card-ink: #f8efdf;
  --card-muted: #d8c9b4;
  --card-paper: #2e2b32;
  --card-wash: #504854;
  --card-stamp: #efc279;
  --card-rule: rgb(248 239 223 / 28%);
}

.membership-card-preview:hover {
  transform: translateY(-2px);
  box-shadow: 0 24px 52px rgb(73 57 105 / 19%);
}

.membership-card-preview__grain {
  position: absolute;
  z-index: -1;
  top: -58px;
  right: -38px;
  width: 190px;
  height: 190px;
  border: 36px solid var(--card-wash);
  border-radius: 48% 52% 44% 56%;
  opacity: 0.7;
  transform: rotate(18deg);
}

.membership-card-preview__head,
.membership-card-preview__foot,
.membership-card-preview__measure {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.membership-card-preview__head {
  align-self: start;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--card-rule);
  font-size: 10px;
  letter-spacing: 0.13em;
}

.membership-card-preview__head strong {
  padding: 6px 9px;
  border: 1px solid currentcolor;
  border-radius: 999px;
  color: var(--card-stamp);
  font-size: 10px;
}

.membership-card-preview__body {
  align-self: center;
}

.membership-card-preview__body p,
.membership-card-preview__body h3 {
  margin: 0;
}

.membership-card-preview__body p {
  color: var(--card-muted);
  font-size: 12px;
  line-height: 1.6;
}

.membership-card-preview__body h3 {
  margin-top: 6px;
  font-size: clamp(24px, 4vw, 36px);
  letter-spacing: -0.04em;
}

.membership-card-preview__measure {
  margin-top: 16px;
}

.membership-card-preview__measure strong {
  color: var(--card-stamp);
  font-size: 20px;
}

.membership-card-preview__measure span {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.membership-card-preview__foot {
  align-self: end;
  color: var(--card-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
}

.membership-card-preview--compact {
  min-height: 190px;
  padding: 17px;
  border-radius: 18px 9px 18px 9px;
}

.membership-card-preview--compact .membership-card-preview__body h3 {
  font-size: 22px;
}

@media (prefers-reduced-motion: reduce) {
  .membership-card-preview {
    transition: none;
  }

  .membership-card-preview:hover {
    transform: none;
  }
}
</style>
