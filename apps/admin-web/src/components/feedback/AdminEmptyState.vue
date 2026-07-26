<script setup lang="ts">
withDefaults(
  defineProps<{
    readonly title: string;
    readonly description?: string;
    readonly tone?: 'lilac' | 'pink' | 'mint';
  }>(),
  { description: undefined, tone: 'lilac' },
);
</script>

<template>
  <div class="admin-empty-state" :data-tone="tone">
    <div class="admin-empty-state__illustration" aria-hidden="true">
      <span class="admin-empty-state__spark">✦</span>
      <span class="admin-empty-state__tray">⌒</span>
    </div>
    <h2>{{ title }}</h2>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.action" class="admin-empty-state__action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.admin-empty-state {
  --empty-accent: var(--admin-primary);
  --empty-soft: var(--admin-primary-soft);

  display: grid;
  justify-items: center;
  padding: 48px 24px;
  text-align: center;
}

.admin-empty-state[data-tone='pink'] {
  --empty-accent: var(--admin-pink);
  --empty-soft: #fcecf2;
}

.admin-empty-state[data-tone='mint'] {
  --empty-accent: var(--admin-mint);
  --empty-soft: #e9f4ef;
}

.admin-empty-state__illustration {
  position: relative;
  display: grid;
  width: 76px;
  height: 76px;
  margin-bottom: 18px;
  place-items: center;
  overflow: hidden;
  background: var(--empty-soft);
  border-radius: 24px;
  color: var(--empty-accent);
}

.admin-empty-state__spark {
  position: absolute;
  top: 13px;
  right: 16px;
  font-size: 17px;
}

.admin-empty-state__tray {
  font-size: 46px;
  font-weight: 700;
  transform: translateY(6px);
}

.admin-empty-state h2 {
  margin: 0;
  color: var(--admin-text);
  font-size: 18px;
}

.admin-empty-state p {
  max-width: 420px;
  margin: 8px 0 0;
  color: var(--admin-muted);
  font-size: 14px;
  line-height: 1.7;
}

.admin-empty-state__action {
  margin-top: 20px;
}
</style>
