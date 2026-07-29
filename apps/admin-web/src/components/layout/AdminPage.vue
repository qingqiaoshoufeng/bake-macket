<script setup lang="ts">
import { useSlots } from 'vue';

withDefaults(
  defineProps<{
    workspace?: boolean;
  }>(),
  {
    workspace: false,
  },
);

const slots = useSlots();
</script>

<template>
  <div
    class="admin-page"
    :class="{
      'admin-page--workspace': workspace,
      'admin-page--with-alert': workspace && Boolean(slots.alert),
    }"
  >
    <template v-if="slots.header">
      <div class="admin-page__header" data-region="page-header">
        <slot name="header" />
      </div>
      <div
        v-if="slots.alert"
        class="admin-page__alert"
        data-region="page-alert"
      >
        <slot name="alert" />
      </div>
      <div class="admin-page__content" data-region="page-content">
        <slot />
      </div>
    </template>
    <slot v-else />
  </div>
</template>

<style scoped>
.admin-page {
  display: grid;
  gap: 20px;
  width: min(100%, var(--admin-content-max));
  margin: 0 auto;
}

.admin-page--workspace {
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.admin-page--workspace.admin-page--with-alert {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.admin-page--workspace .admin-page__header,
.admin-page--workspace .admin-page__alert,
.admin-page--workspace .admin-page__content {
  min-width: 0;
}

.admin-page--workspace .admin-page__content {
  min-height: 0;
  overflow: hidden;
}
</style>
