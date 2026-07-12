<script setup lang="ts">
/**
 * Placeholder home view for the storefront shell.
 *
 * Task 8 only delivers the application skeleton (router, theme, auth
 * guard); the catalog/feed implementation lands in Task 9. The view exists
 * so the router can mount without 404-ing on `/`.
 */
</script>

<template>
  <section class="home">
    <h1>烘焙商城</h1>
    <p>商品与首页内容将在后续任务中上线。</p>
  </section>
</template>

<style scoped>
.home {
  padding: 24px 16px;
}
h1 {
  color: var(--mall-leaf);
  font-size: 22px;
  margin: 0 0 8px;
}
p {
  color: var(--mall-muted);
  font-size: 14px;
  margin: 0;
}
</style>
