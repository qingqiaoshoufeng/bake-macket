<template>
  <div class="admin-page">
    <slot />
  </div>
</template>

<style scoped>
.admin-page {
  display: grid;
  gap: 20px;
  width: min(100%, var(--admin-content-max));
  margin: 0 auto;
}
</style>
