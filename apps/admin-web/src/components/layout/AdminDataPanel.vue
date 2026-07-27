<template>
  <section class="admin-data-panel">
    <div
      v-if="$slots.toolbar"
      class="admin-data-panel__toolbar"
      data-region="toolbar"
    >
      <slot name="toolbar" />
    </div>
    <div
      class="admin-data-panel__data admin-horizontal-scroll"
      data-region="data"
    >
      <slot />
    </div>
    <footer
      v-if="$slots.footer"
      class="admin-data-panel__footer"
      data-region="footer"
    >
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
.admin-data-panel {
  overflow: hidden;
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  box-shadow: var(--admin-shadow-card);
}

.admin-data-panel__toolbar,
.admin-data-panel__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
}

.admin-data-panel__toolbar {
  border-bottom: 1px solid var(--admin-border);
}

.admin-data-panel__data {
  min-width: 0;
}

.admin-data-panel__footer {
  justify-content: flex-end;
  border-top: 1px solid var(--admin-border);
}
</style>
