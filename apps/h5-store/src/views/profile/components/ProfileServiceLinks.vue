<script setup lang="ts">
import { PROFILE_LINKS } from '../config/links.js';

defineEmits<{ (event: 'navigate', path: string): void }>();
</script>

<template>
  <nav class="profile-links" aria-label="个人功能">
    <button
      v-for="link in PROFILE_LINKS"
      :key="link.path"
      type="button"
      @click="$emit('navigate', link.path)"
    >
      <span>{{ link.label }}</span
      ><span aria-hidden="true">›</span>
    </button>
  </nav>
</template>

<style scoped>
.profile-links {
  display: grid;
  padding: var(--mall-space-1) var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.profile-links button {
  display: flex;
  min-height: 52px;
  padding: 0 var(--mall-space-2);
  align-items: center;
  justify-content: space-between;
  border: 0;
  border-bottom: 1px solid var(--mall-border);
  background: transparent;
  color: var(--mall-text);
  font: inherit;
  cursor: pointer;
}
.profile-links button:last-child {
  border-bottom: 0;
}
.profile-links button span:last-child {
  color: var(--mall-primary-strong);
  font-size: 24px;
}
.profile-links button:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--mall-primary) 40%, transparent);
  outline-offset: -3px;
}
</style>
