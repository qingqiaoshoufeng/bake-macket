<script setup lang="ts">
import AdminBrandArt from './login/components/AdminBrandArt.vue';
import AdminLoginForm from './login/components/AdminLoginForm.vue';
import { useAdminLogin } from './login/hooks/useAdminLogin.js';

const {
  kind,
  email,
  phone,
  password,
  submitting,
  showDevHint,
  selectKind,
  submit,
} = useAdminLogin();
</script>

<template>
  <main class="admin-auth-page">
    <div class="admin-auth-page__form">
      <AdminLoginForm
        :kind="kind"
        :email="email"
        :phone="phone"
        :password="password"
        :submitting="submitting"
        :show-dev-hint="showDevHint"
        @update:email="email = $event"
        @update:phone="phone = $event"
        @update:password="password = $event"
        @select-kind="selectKind"
        @submit="submit"
      />
    </div>
    <AdminBrandArt class="admin-auth-page__art" />
  </main>
</template>

<style scoped>
.admin-auth-page {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: clamp(24px, 3vw, 48px);
  min-height: 100vh;
  padding: clamp(24px, 4vw, 48px);
  background:
    radial-gradient(circle at 8% 8%, rgb(233 139 172 / 10%), transparent 24%),
    radial-gradient(circle at 54% 94%, rgb(120 170 149 / 9%), transparent 26%),
    var(--admin-canvas);
}

.admin-auth-page__form {
  display: grid;
  align-items: center;
  justify-items: end;
  min-width: 0;
}

@media (max-width: 1024px) {
  .admin-auth-page {
    grid-template-columns: minmax(0, 1fr);
    padding: 24px;
  }

  .admin-auth-page__form {
    justify-items: center;
  }

  .admin-auth-page__art {
    display: none;
  }
}

@media (max-width: 480px) {
  .admin-auth-page {
    padding: 14px;
  }
}
</style>
