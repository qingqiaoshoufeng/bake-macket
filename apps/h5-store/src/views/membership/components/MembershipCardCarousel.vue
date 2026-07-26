<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Swipe, SwipeItem } from 'vant';

import MembershipCard from './MembershipCard.vue';
import { createMembershipCarouselItems } from '../hooks/purchase-capability.js';
import type { MembershipOverviewModel } from '../type/index.js';

const props = withDefaults(
  defineProps<{
    overview: MembershipOverviewModel;
    prefersReducedMotion?: boolean;
  }>(),
  {
    prefersReducedMotion: () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  },
);
defineEmits<{ (event: 'open', id: string): void }>();

const items = computed(() => createMembershipCarouselItems(props.overview));
const activeIndex = ref(0);
watch(
  () => props.overview.currentMembership?.id,
  () => {
    activeIndex.value = 0;
  },
);
</script>

<template>
  <section
    class="membership-carousel"
    aria-labelledby="membership-carousel-title"
  >
    <div class="membership-carousel__heading">
      <div>
        <p>MY BAKE PASSPORT</p>
        <h2 id="membership-carousel-title">我的会员卡</h2>
      </div>
      <strong v-if="items.length" data-testid="carousel-page">
        {{ activeIndex + 1 }} / {{ items.length }}
      </strong>
    </div>
    <Swipe
      v-if="items.length"
      :autoplay="0"
      :initial-swipe="0"
      :show-indicators="false"
      :loop="false"
      :duration="prefersReducedMotion ? 0 : 500"
      aria-roledescription="carousel"
      @change="activeIndex = $event"
    >
      <SwipeItem v-for="item in items" :key="item.level.id">
        <div class="membership-carousel__slide">
          <MembershipCard
            :item="item"
            :available-credit-cents="overview.account.availableCreditCents"
            :ends-at="
              item.isCurrent ? overview.currentMembership?.endsAt : undefined
            "
            @open="$emit('open', $event)"
          />
        </div>
      </SwipeItem>
    </Swipe>
    <p
      v-if="items.length"
      class="membership-carousel__caption"
      aria-live="polite"
    >
      {{ items[activeIndex]?.capability.description }}，左右滑动查看更多卡片。
    </p>
    <div
      v-if="items.length > 1"
      class="membership-carousel__dots"
      aria-hidden="true"
    >
      <span
        v-for="(_, index) in items"
        :key="index"
        :class="{ 'is-active': index === activeIndex }"
      />
    </div>
  </section>
</template>

<style scoped>
.membership-carousel {
  min-width: 0;
  padding: var(--mall-space-4);
  overflow: hidden;
  border: 1px solid
    color-mix(in srgb, var(--mall-primary) 18%, var(--mall-border));
  border-radius: var(--mall-radius-feature);
  background: linear-gradient(180deg, #fff, #f3f8f1);
  box-shadow: var(--mall-shadow-card);
}
.membership-carousel__heading {
  display: flex;
  margin-bottom: var(--mall-space-3);
  align-items: end;
  justify-content: space-between;
  gap: var(--mall-space-2);
}
.membership-carousel__heading p,
.membership-carousel__heading h2 {
  margin: 0;
}
.membership-carousel__heading p {
  color: var(--mall-accent);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.15em;
}
.membership-carousel__heading h2 {
  margin-top: 2px;
  font-family: Georgia, 'Songti SC', serif;
  font-size: 18px;
}
.membership-carousel__heading strong {
  color: var(--mall-primary-strong);
  font-size: 12px;
}
.membership-carousel__slide {
  padding: 4px 3px 18px;
}
.membership-carousel__caption {
  min-height: 20px;
  margin: 0;
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}
.membership-carousel__dots {
  display: flex;
  margin-top: var(--mall-space-2);
  justify-content: center;
  gap: 6px;
}
.membership-carousel__dots span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--mall-border);
  transition:
    width 180ms ease,
    background 180ms ease;
}
.membership-carousel__dots .is-active {
  width: 20px;
  background: var(--mall-primary);
}
@media (prefers-reduced-motion: reduce) {
  .membership-carousel__dots span {
    transition: none;
  }
}
</style>
