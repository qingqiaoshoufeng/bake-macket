<script setup lang="ts">
defineProps<{
  readonly title: string;
  readonly eyebrow?: string;
  readonly description?: string;
}>();
</script>

<template>
  <header class="admin-page-header">
    <div class="admin-page-header__copy">
      <p v-if="eyebrow" class="admin-page-header__eyebrow">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p v-if="description" class="admin-page-header__description">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="admin-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.admin-page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 4px 2px;
}

.admin-page-header__copy {
  min-width: 0;
}

.admin-page-header__eyebrow {
  margin: 0 0 8px;
  color: var(--admin-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.admin-page-header h1 {
  margin: 0;
  color: var(--admin-text);
  font-size: clamp(24px, 2.2vw, 32px);
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.admin-page-header__description {
  margin: 8px 0 0;
  color: var(--admin-muted);
  font-size: 14px;
  line-height: 1.7;
}

.admin-page-header__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
}

@media (max-width: 720px) {
  .admin-page-header {
    align-items: stretch;
    flex-direction: column;
  }

  .admin-page-header__actions {
    justify-content: flex-start;
  }
}
</style>
