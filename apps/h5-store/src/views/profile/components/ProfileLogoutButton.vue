<script setup lang="ts">
defineEmits<{ (event: 'logout'): void }>();
</script>

<template>
  <button
    type="button"
    class="profile-logout"
    data-testid="logout"
    @click="$emit('logout')"
  >
    退出登录
  </button>
</template>

<style scoped>
.profile-logout {
  width: 100%;
  min-height: 48px;
  border: 1px solid
    color-mix(in srgb, var(--mall-danger) 35%, var(--mall-border));
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  color: var(--mall-danger);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.profile-logout:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--mall-danger) 25%, transparent);
  outline-offset: 2px;
}
</style>
