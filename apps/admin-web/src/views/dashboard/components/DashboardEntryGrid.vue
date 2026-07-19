<script setup lang="ts">
import type { DashboardEntry } from '../type/index.js';

defineProps<{
  readonly entries: readonly DashboardEntry[];
}>();

const emit = defineEmits<{
  open: [path: string];
}>();
</script>

<template>
  <section
    class="dashboard-entry-section"
    aria-labelledby="dashboard-entry-title"
  >
    <div class="dashboard-entry-section__head">
      <div>
        <p>QUICK START</p>
        <h2 id="dashboard-entry-title">常用功能</h2>
      </div>
      <span>选择一项工作开始今天的营业</span>
    </div>

    <div class="dashboard-entry-grid">
      <button
        v-for="entry in entries"
        :key="entry.key"
        type="button"
        class="dashboard-entry-card"
        :data-tone="entry.tone"
        data-testid="dashboard-entry"
        @click="emit('open', entry.route)"
      >
        <span class="dashboard-entry-card__icon" aria-hidden="true">
          {{ entry.icon }}
        </span>
        <span class="dashboard-entry-card__copy">
          <strong>{{ entry.title }}</strong>
          <span>{{ entry.description }}</span>
        </span>
        <span class="dashboard-entry-card__cta">{{ entry.cta }} →</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.dashboard-entry-section {
  display: grid;
  gap: 16px;
}

.dashboard-entry-section__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  padding: 0 2px;
}

.dashboard-entry-section__head p {
  margin: 0 0 5px;
  color: var(--admin-primary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.dashboard-entry-section__head h2 {
  margin: 0;
  color: var(--admin-text);
  font-size: 20px;
}

.dashboard-entry-section__head > span {
  color: var(--admin-muted);
  font-size: 13px;
}

.dashboard-entry-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.dashboard-entry-card {
  --entry-accent: var(--admin-primary);
  --entry-soft: var(--admin-primary-soft);

  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 18px;
  min-height: 210px;
  padding: 21px;
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  color: inherit;
  text-align: left;
  box-shadow: var(--admin-shadow-card);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.dashboard-entry-card[data-tone='pink'] {
  --entry-accent: #bd5c81;
  --entry-soft: #fbeaf1;
}

.dashboard-entry-card[data-tone='mint'] {
  --entry-accent: #477d68;
  --entry-soft: #e9f4ef;
}

.dashboard-entry-card[data-tone='yellow'] {
  --entry-accent: #8b641f;
  --entry-soft: #fbf1d9;
}

.dashboard-entry-card:hover,
.dashboard-entry-card:focus-visible {
  border-color: color-mix(in srgb, var(--entry-accent) 38%, white);
  box-shadow: 0 16px 36px rgb(73 57 105 / 11%);
  outline: none;
  transform: translateY(-2px);
}

.dashboard-entry-card__icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  background: var(--entry-soft);
  border-radius: 14px;
  color: var(--entry-accent);
  font-size: 15px;
  font-weight: 900;
}

.dashboard-entry-card__copy {
  display: grid;
  align-content: start;
  gap: 8px;
}

.dashboard-entry-card__copy strong {
  color: var(--admin-text);
  font-size: 17px;
}

.dashboard-entry-card__copy span {
  color: var(--admin-muted);
  font-size: 13px;
  line-height: 1.65;
}

.dashboard-entry-card__cta {
  color: var(--entry-accent);
  font-size: 13px;
  font-weight: 700;
}

@media (max-width: 1280px) {
  .dashboard-entry-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .dashboard-entry-section__head {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .dashboard-entry-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-entry-card {
    min-height: 190px;
  }
}
</style>
