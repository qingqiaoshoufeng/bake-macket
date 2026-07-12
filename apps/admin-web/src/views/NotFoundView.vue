<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goHome(): void {
  void router.replace('/dashboard');
}
</script>

<template>
  <main class="not-found">
    <div class="not-found__card">
      <span class="not-found__badge">404</span>
      <h1>页面未找到</h1>
      <p>请检查链接是否正确,或返回概览继续操作。</p>
      <button type="button" class="not-found__cta" @click="goHome">
        返回概览
      </button>
    </div>
  </main>
</template>

<style scoped>
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #f6f4fb;
}

.not-found__card {
  background: #fff;
  border-radius: 16px;
  padding: 32px 36px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 12px 40px rgba(123, 97, 200, 0.12);
}

.not-found__badge {
  align-self: center;
  background: var(--admin-lilac);
  color: #5e3fb2;
  border-radius: 999px;
  padding: 2px 10px;
  font-weight: 500;
}

.not-found__card h1 {
  margin: 0;
  color: #2f2a3d;
  font-size: 22px;
}

.not-found__card p {
  margin: 0;
  color: #6f5d80;
  font-size: 14px;
}

.not-found__cta {
  align-self: center;
  border: 0;
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 10px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
}
</style>
