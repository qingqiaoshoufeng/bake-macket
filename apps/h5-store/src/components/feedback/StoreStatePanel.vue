<script setup lang="ts">
withDefaults(
  defineProps<{
    state: 'loading' | 'empty' | 'error';
    title: string;
    description?: string;
  }>(),
  {
    description: undefined,
  },
);
</script>

<template>
  <section class="store-state-panel" :data-state="state" aria-live="polite">
    <div class="store-state-panel__marker" aria-hidden="true">
      <span v-if="state === 'loading'" class="store-state-panel__spinner" />
      <span v-else>{{ state === 'empty' ? '○' : '!' }}</span>
    </div>
    <p class="store-state-panel__state">{{ state }}</p>
    <h2 class="store-state-panel__title">{{ title }}</h2>
    <p v-if="description" class="store-state-panel__description">
      {{ description }}
    </p>
    <div v-if="$slots.action" class="store-state-panel__action">
      <slot name="action" />
    </div>
  </section>
</template>

<style scoped>
.store-state-panel {
  display: flex;
  min-height: 220px;
  padding: var(--mall-space-8) var(--mall-space-5);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
  text-align: center;
}

.store-state-panel__marker {
  display: grid;
  width: 48px;
  height: 48px;
  margin-bottom: var(--mall-space-3);
  place-items: center;
  border-radius: 50%;
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-size: 22px;
  font-weight: 700;
}

.store-state-panel[data-state='error'] .store-state-panel__marker {
  background: color-mix(in srgb, var(--mall-danger) 12%, var(--mall-surface));
  color: var(--mall-danger);
}

.store-state-panel__spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--mall-border);
  border-top-color: var(--mall-primary-strong);
  border-radius: 50%;
  animation: store-state-panel-spin 0.8s linear infinite;
}

.store-state-panel__state,
.store-state-panel__title,
.store-state-panel__description {
  margin: 0;
}

.store-state-panel__state {
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  line-height: 1.4;
  text-transform: uppercase;
}

.store-state-panel[data-state='error'] .store-state-panel__state {
  color: var(--mall-danger);
}

.store-state-panel__title {
  margin-top: var(--mall-space-1);
  color: var(--mall-text);
  font-size: 18px;
  line-height: 1.4;
}

.store-state-panel__description {
  max-width: 320px;
  margin-top: var(--mall-space-2);
  color: var(--mall-text-muted);
  font-size: 14px;
  line-height: 1.6;
}

.store-state-panel__action {
  margin-top: var(--mall-space-5);
}

@keyframes store-state-panel-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .store-state-panel__spinner {
    animation: none;
  }
}
</style>
