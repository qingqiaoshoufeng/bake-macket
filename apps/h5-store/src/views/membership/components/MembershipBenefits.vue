<script setup lang="ts">
import type { MembershipBenefit } from '@bake-mall/contracts';

defineProps<{ benefits: readonly MembershipBenefit[]; title?: string }>();
</script>

<template>
  <section class="membership-benefits">
    <div class="membership-benefits__heading">
      <p>PASS PRIVILEGES</p>
      <h2>{{ title ?? '护照权益' }}</h2>
    </div>
    <ul>
      <li
        v-for="(benefit, index) in benefits"
        :key="`${benefit.sortOrder}-${benefit.title}`"
      >
        <span>{{ String(index + 1).padStart(2, '0') }}</span>
        <div>
          <strong>{{ benefit.title }}</strong>
          <p v-if="benefit.description">{{ benefit.description }}</p>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.membership-benefits {
  padding: var(--mall-space-5);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.membership-benefits__heading p,
.membership-benefits__heading h2 {
  margin: 0;
}
.membership-benefits__heading p {
  color: var(--mall-accent);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
}
.membership-benefits__heading h2 {
  margin-top: 2px;
  font-family: Georgia, 'Songti SC', serif;
  font-size: 18px;
}
.membership-benefits ul {
  display: grid;
  margin: var(--mall-space-4) 0 0;
  padding: 0;
  gap: var(--mall-space-3);
  list-style: none;
}
.membership-benefits li {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: var(--mall-space-3);
}
.membership-benefits li > span {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 800;
}
.membership-benefits strong {
  font-size: 14px;
}
.membership-benefits li p {
  margin: 3px 0 0;
  color: var(--mall-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
</style>
