<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function backHome(): void {
  void router.replace('/');
}
</script>

<template>
  <section class="not-found">
    <h1>页面未找到</h1>
    <p>链接可能已失效,返回首页继续逛逛吧。</p>
    <button type="button" class="not-found__action" @click="backHome">
      返回首页
    </button>
  </section>
</template>

<style scoped>
.not-found {
  padding: 48px 16px;
  text-align: center;
  color: var(--mall-ink);
}
h1 {
  margin: 0 0 8px;
  color: var(--mall-apricot);
  font-size: 22px;
}
p {
  margin: 0 0 16px;
  color: var(--mall-muted);
  font-size: 14px;
}
.not-found__action {
  border: 0;
  background: var(--van-primary-color);
  color: #fff;
  border-radius: var(--van-radius-lg);
  padding: 10px 18px;
  font-size: 14px;
}
</style>
