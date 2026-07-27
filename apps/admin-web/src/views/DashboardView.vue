<script setup lang="ts">
import AdminPage from '../components/layout/AdminPage.vue';
import AdminPageHeader from '../components/layout/AdminPageHeader.vue';
import DashboardEntryGrid from './dashboard/components/DashboardEntryGrid.vue';
import OrderFlowGuide from './dashboard/components/OrderFlowGuide.vue';
import { useDashboardNavigation } from './dashboard/hooks/useDashboardNavigation.js';

const { entries, orderFlow, openEntry } = useDashboardNavigation();
</script>

<template>
  <AdminPage>
    <section class="dashboard-hero">
      <AdminPageHeader
        eyebrow="GOOD DAY, MANAGER"
        title="欢迎回来，今天也一起认真营业"
        description="从商品内容到订单履约，店长小助手把常用工作放在触手可及的位置。"
      />
      <div class="dashboard-hero__art" aria-hidden="true">
        <span class="dashboard-hero__spark">✦</span>
        <div class="dashboard-hero__bread">
          <span></span><span></span><span></span>
        </div>
        <div class="dashboard-hero__label">FRESH TODAY</div>
      </div>
    </section>

    <DashboardEntryGrid :entries="entries" @open="openEntry" />
    <OrderFlowGuide :flow="orderFlow" />
  </AdminPage>
</template>

<style scoped>
.dashboard-hero {
  position: relative;
  min-height: 220px;
  padding: clamp(26px, 4vw, 42px);
  overflow: hidden;
  background:
    radial-gradient(circle at 78% 24%, rgb(233 139 172 / 18%), transparent 25%),
    radial-gradient(circle at 93% 86%, rgb(120 170 149 / 16%), transparent 24%),
    linear-gradient(130deg, #fff 0%, #faf8ff 54%, #f3effa 100%);
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-feature);
  box-shadow: var(--admin-shadow-card);
}

.dashboard-hero :deep(.admin-page-header) {
  position: relative;
  z-index: 2;
  max-width: 720px;
  min-height: 138px;
  align-items: center;
}

.dashboard-hero__art {
  position: absolute;
  top: 0;
  right: 0;
  width: min(34%, 390px);
  height: 100%;
}

.dashboard-hero__spark {
  position: absolute;
  top: 30px;
  right: 40px;
  color: var(--admin-pink);
  font-size: 26px;
}

.dashboard-hero__bread {
  position: absolute;
  right: 56px;
  bottom: 24px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  width: 150px;
  height: 100px;
  background: #f3c980;
  border: 4px solid #756285;
  border-radius: 68px 68px 34px 34px;
  box-shadow: 12px 14px 0 rgb(121 101 184 / 10%);
  transform: rotate(4deg);
}

.dashboard-hero__bread span {
  width: 4px;
  height: 55px;
  margin-bottom: 17px;
  background: rgb(255 255 255 / 48%);
  border-radius: 999px;
  transform: rotate(20deg);
}

.dashboard-hero__label {
  position: absolute;
  right: 172px;
  bottom: 32px;
  padding: 8px 12px;
  background: #fff;
  border: 1px dashed var(--admin-pink);
  border-radius: 8px;
  color: #a45172;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.12em;
  transform: rotate(-7deg);
}

@media (max-width: 1024px) {
  .dashboard-hero__art {
    opacity: 0.64;
  }

  .dashboard-hero__bread {
    right: 30px;
  }

  .dashboard-hero__label {
    right: 138px;
  }
}

@media (max-width: 760px) {
  .dashboard-hero {
    min-height: auto;
  }

  .dashboard-hero :deep(.admin-page-header) {
    max-width: calc(100% - 90px);
  }

  .dashboard-hero__bread {
    right: 14px;
    bottom: 16px;
    width: 78px;
    height: 58px;
  }

  .dashboard-hero__bread span,
  .dashboard-hero__label {
    display: none;
  }
}
</style>
