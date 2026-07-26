<script setup lang="ts">
import {
  MembershipLevelStatus,
  type AdminMembershipLevelListItem,
} from '@bake-mall/contracts';
import {
  ElAlert,
  ElButton,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
} from 'element-plus';
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { ApiClientError } from '../../api/http.js';
import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import MembershipCardTable from './components/MembershipCardTable.vue';
import { useMembershipCards } from './hooks/useMembershipCards.js';

const router = useRouter();
const cards = useMembershipCards();

onMounted(cards.refresh);

function messageOf(error: unknown): string {
  return error instanceof ApiClientError || error instanceof Error
    ? error.message
    : '操作失败，请重试';
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
  <AdminPage class="membership-cards-view">
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

    <ElAlert
      v-if="cards.loadError.value"
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

    <AdminDataPanel>
      <div
        class="membership-cards-view__toolbar"
        role="search"
        aria-label="筛选会员卡"
      >
        <ElInput
          :model-value="cards.filters.q"
          clearable
          placeholder="搜索名称或 code"
          aria-label="搜索会员卡"
          @update:model-value="cards.setFilters({ q: String($event) })"
          @keyup.enter="cards.refresh"
        />
        <ElSelect
          :model-value="cards.filters.status"
          clearable
          placeholder="全部状态"
          aria-label="筛选会员卡状态"
          @update:model-value="cards.setFilters({ status: $event || '' })"
        >
          <ElOption label="已上架" :value="MembershipLevelStatus.ACTIVE" />
          <ElOption label="下架草稿" :value="MembershipLevelStatus.INACTIVE" />
        </ElSelect>
        <ElButton type="primary" plain @click="cards.refresh">筛选</ElButton>
      </div>

      <MembershipCardTable
        :levels="cards.levels.value"
        :loading="cards.loading.value"
        :action-id="cards.actionId.value"
        @edit="editCard"
        @toggle="toggleCard"
        @remove="removeDraft"
      />
    </AdminDataPanel>
  </AdminPage>
</template>

<style scoped>
.membership-cards-view__error-copy {
  margin: 0 0 10px;
}

.membership-cards-view__toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 180px auto;
  gap: 12px;
  padding: 18px;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface-soft);
}

@media (max-width: 720px) {
  .membership-cards-view__toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
