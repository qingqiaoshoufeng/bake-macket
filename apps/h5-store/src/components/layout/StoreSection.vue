<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    eyebrow?: string;
    description?: string;
  }>(),
  {
    eyebrow: undefined,
    description: undefined,
  },
);
</script>

<template>
  <section class="store-section">
    <div class="store-section__header">
      <div class="store-section__heading">
        <p v-if="eyebrow" class="store-section__eyebrow">{{ eyebrow }}</p>
        <h2 class="store-section__title">{{ title }}</h2>
        <p v-if="description" class="store-section__description">
          {{ description }}
        </p>
      </div>

      <div v-if="$slots.actions" class="store-section__actions">
        <slot name="actions" />
      </div>
    </div>

    <div class="store-section__content">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.store-section + .store-section {
  margin-top: var(--mall-space-8);
}

.store-section__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--mall-space-4);
  margin-bottom: var(--mall-space-4);
}

.store-section__heading {
  min-width: 0;
}

.store-section__eyebrow,
.store-section__title,
.store-section__description {
  margin: 0;
}

.store-section__eyebrow {
  margin-bottom: var(--mall-space-1);
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  line-height: 1.4;
  text-transform: uppercase;
}

.store-section__title {
  color: var(--mall-text);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.35;
}

.store-section__description {
  margin-top: var(--mall-space-1);
  color: var(--mall-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.store-section__actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}
</style>
