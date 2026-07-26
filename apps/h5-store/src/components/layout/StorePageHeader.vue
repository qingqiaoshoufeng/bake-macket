<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    eyebrow?: string;
    description?: string;
    back?: boolean;
  }>(),
  {
    eyebrow: undefined,
    description: undefined,
    back: false,
  },
);

defineEmits<{
  back: [];
}>();
</script>

<template>
  <header class="store-page-header">
    <button
      v-if="back"
      class="store-page-header__back"
      type="button"
      aria-label="返回"
      @click="$emit('back')"
    >
      <span aria-hidden="true">‹</span>
    </button>

    <div class="store-page-header__content">
      <p v-if="eyebrow" class="store-page-header__eyebrow">{{ eyebrow }}</p>
      <h1 class="store-page-header__title">{{ title }}</h1>
      <p v-if="description" class="store-page-header__description">
        {{ description }}
      </p>
      <slot />
    </div>

    <div v-if="$slots.actions" class="store-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.store-page-header {
  display: flex;
  align-items: flex-start;
  gap: var(--mall-space-3);
  margin-bottom: var(--mall-space-6);
}

.store-page-header__content {
  min-width: 0;
  flex: 1;
}

.store-page-header__back {
  display: grid;
  width: 44px;
  height: 44px;
  margin: var(--mall-space-1) 0 0;
  padding: 0;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--mall-border);
  border-radius: 50%;
  background: var(--mall-surface);
  color: var(--mall-primary-strong);
  box-shadow: var(--mall-shadow-card);
  font: inherit;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}

.store-page-header__eyebrow,
.store-page-header__title,
.store-page-header__description {
  margin: 0;
}

.store-page-header__eyebrow {
  margin-bottom: var(--mall-space-1);
  color: var(--mall-primary-strong);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  line-height: 1.4;
  text-transform: uppercase;
}

.store-page-header__title {
  color: var(--mall-text);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.store-page-header__description {
  margin-top: var(--mall-space-2);
  color: var(--mall-text-muted);
  font-size: 14px;
  line-height: 1.6;
}

.store-page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--mall-space-2);
  flex: 0 0 auto;
}
</style>
