<script setup lang="ts">
import {
  MembershipLevelStatus,
  type AdminMembershipLevelListItem,
} from '@bake-mall/contracts';
import {
  ElAlert,
  ElButton,
  ElMessage,
  ElMessageBox,
  ElPagination,
} from 'element-plus';
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { ApiClientError } from '../../api/http.js';
import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import { PAGE_SIZE_OPTIONS } from '../../config/pagination.js';
import MembershipCardFilters from './components/MembershipCardFilters.vue';
import MembershipCardTable from './components/MembershipCardTable.vue';
import { useMembershipCards } from './hooks/useMembershipCards.js';
import type { MembershipCardFilters as MembershipCardFilterForm } from './type/index.js';

const router = useRouter();
const cards = useMembershipCards();

onMounted(cards.refresh);

function messageOf(error: unknown): string {
  return error instanceof ApiClientError || error instanceof Error
    ? error.message
    : '操作失败，请重试';
}

function updateFilters(value: Partial<MembershipCardFilterForm>): void {
  cards.setFilters(value);
}

function createCard(): void {
  void router.push('/membership-cards/new');
}

function editCard(id: string): void {
  void router.push(`/membership-cards/${id}/edit`);
}

async function toggleCard(level: AdminMembershipLevelListItem): Promise<void> {
  const verb = level.status === MembershipLevelStatus.ACTIVE ? '下架' : '上架';
  try {
    await ElMessageBox.confirm(
      `${verb}“${level.name}”？操作会使用当前版本 v${level.version}。`,
      `${verb}会员卡`,
      { confirmButtonText: verb, cancelButtonText: '取消', type: 'warning' },
    );
    await cards.toggleStatus(level);
    ElMessage.success(`会员卡已${verb}`);
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(messageOf(error));
  }
}

async function removeDraft(level: AdminMembershipLevelListItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除未售草稿“${level.name}”？此操作不可撤销。`,
      '删除草稿',
      {
        confirmButtonText: '删除草稿',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
    await cards.remove(level);
    ElMessage.success('草稿已删除');
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(messageOf(error));
  }
}
</script>

<template>
  <AdminPage workspace class="membership-cards-view">
    <template #header>
      <AdminPageHeader
        eyebrow="MEMBERSHIP STUDIO"
        title="会员卡配置"
        description="创建等级配方，预览受控卡面，并安全管理上架状态与未售草稿。"
      >
        <template #actions>
          <ElButton
            type="primary"
            data-testid="create-membership-card"
            @click="createCard"
          >
            新建会员卡
          </ElButton>
        </template>
      </AdminPageHeader>
    </template>

    <template v-if="cards.loadError.value" #alert>
      <ElAlert
        type="error"
        title="会员卡列表加载失败"
        :closable="false"
        show-icon
      >
        <template #default>
          <p class="membership-cards-view__error-copy">
            {{ messageOf(cards.loadError.value) }}
          </p>
          <ElButton size="small" @click="cards.refresh">重新加载</ElButton>
        </template>
      </ElAlert>
    </template>

    <AdminDataPanel fill>
      <template #toolbar>
        <MembershipCardFilters
          :filters="cards.filters"
          :loading="cards.loading.value"
          @change="updateFilters"
          @search="cards.search"
          @reset="cards.reset"
        />
      </template>

      <MembershipCardTable
        :levels="cards.levels.value"
        :loading="cards.loading.value"
        :action-id="cards.actionId.value"
        @edit="editCard"
        @toggle="toggleCard"
        @remove="removeDraft"
      />

      <template v-if="cards.total.value > 0" #footer>
        <ElPagination
          class="membership-cards-view__pagination"
          background
          layout="total, sizes, prev, pager, next"
          :total="cards.total.value"
          :current-page="cards.page.value"
          :page-size="cards.pageSize.value"
          :page-sizes="[...PAGE_SIZE_OPTIONS]"
          @update:current-page="cards.setPage"
          @update:page-size="cards.setPageSize"
        />
      </template>
    </AdminDataPanel>
  </AdminPage>
</template>

<style scoped>
.membership-cards-view__error-copy {
  margin: 0 0 10px;
}

.membership-cards-view__pagination {
  justify-content: flex-end;
}
</style>
