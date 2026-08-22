<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElInput,
  ElMessage,
  ElPagination,
} from 'element-plus';
import { onMounted } from 'vue';

import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import CreateUserDialog from './components/CreateUserDialog.vue';
import OperatorGrantDialog from './components/OperatorGrantDialog.vue';
import OperatorRevokeDialog from './components/OperatorRevokeDialog.vue';
import UserDetailDrawer from './components/UserDetailDrawer.vue';
import UserTable from './components/UserTable.vue';
import { USER_PAGINATION } from './config/defaults.js';
import { useOperatorActions } from './hooks/useOperatorActions.js';
import { useUserDetail } from './hooks/useUserDetail.js';
import { useUsers } from './hooks/useUsers.js';

const users = useUsers();
const userDetail = useUserDetail();
const operatorActions = useOperatorActions(() =>
  users.refresh({ reportError: false }),
);

onMounted(async () => {
  try {
    await users.refresh();
  } catch {
    // The persistent alert renders the safe hook error.
  }
});

async function search(): Promise<void> {
  try {
    await users.search();
  } catch {
    // The persistent alert renders the safe hook error.
  }
}

async function changePage(page: number): Promise<void> {
  try {
    await users.setPage(page);
  } catch {
    // The persistent alert renders the safe hook error.
  }
}

async function changePageSize(pageSize: number): Promise<void> {
  try {
    await users.setPageSize(pageSize);
  } catch {
    // The persistent alert renders the safe hook error.
  }
}

async function createUser(): Promise<void> {
  try {
    await users.createUser();
    ElMessage.success('用户添加成功');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '用户添加失败');
  }
}

async function grantOperator(): Promise<void> {
  try {
    await operatorActions.grant();
    ElMessage.success('操作员授权成功');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作员授权失败');
  }
}

async function revokeOperator(): Promise<void> {
  try {
    await operatorActions.revoke();
    ElMessage.success('操作员权限已撤销');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '角色撤销失败');
  }
}
</script>

<template>
  <AdminPage workspace>
    <template #header>
      <AdminPageHeader
        eyebrow="CUSTOMER DIRECTORY"
        title="用户管理"
        description="直接核对微信 OpenID / UnionID、身份手机号与独立管理员登录号，按权限添加用户并管理操作员角色。"
      >
        <template v-if="users.canCreate.value" #actions>
          <ElButton
            type="primary"
            data-testid="open-create-user"
            @click="users.openCreate"
          >
            添加用户
          </ElButton>
        </template>
      </AdminPageHeader>
    </template>

    <template
      v-if="
        users.lastError.value ||
        operatorActions.lastError.value ||
        users.lastWarning.value ||
        operatorActions.lastWarning.value
      "
      #alert
    >
      <ElAlert
        :type="
          operatorActions.lastError.value || users.lastError.value
            ? 'error'
            : 'warning'
        "
        :title="
          operatorActions.lastError.value ??
          users.lastError.value ??
          operatorActions.lastWarning.value ??
          users.lastWarning.value ??
          '操作失败，请稍后重试'
        "
        :closable="false"
        show-icon
      />
    </template>

    <AdminDataPanel fill>
      <template #toolbar>
        <div class="users-page__toolbar">
          <ElInput
            :model-value="users.query.value"
            aria-label="搜索用户"
            clearable
            placeholder="搜索身份手机号、管理员登录手机号、昵称或用户 ID"
            class="users-page__search"
            data-testid="users-search-input"
            @update:model-value="users.setQuery(String($event))"
            @keyup.enter="search"
            @clear="search"
          />
          <ElButton
            type="primary"
            plain
            :loading="users.loading.value"
            data-testid="users-search-submit"
            @click="search"
          >
            搜索
          </ElButton>
        </div>
      </template>

      <UserTable
        :users="users.users.value"
        :loading="users.loading.value"
        :can-manage-roles="operatorActions.canManageRoles.value"
        @detail="userDetail.open($event.id)"
        @grant="operatorActions.openGrant"
        @revoke="operatorActions.openRevoke"
      />

      <template v-if="users.total.value > 0" #footer>
        <ElPagination
          background
          layout="total, sizes, prev, pager, next"
          :total="users.total.value"
          :current-page="users.page.value"
          :page-size="users.pageSize.value"
          :page-sizes="[...USER_PAGINATION.pageSizes]"
          @update:current-page="changePage"
          @update:page-size="changePageSize"
        />
      </template>
    </AdminDataPanel>

    <UserDetailDrawer
      :model-value="userDetail.visible.value"
      :detail="userDetail.detail.value"
      :loading="userDetail.loading.value"
      :error="userDetail.error.value"
      @close="userDetail.close"
      @retry="userDetail.retry"
    />
    <CreateUserDialog
      :visible="users.createDialogVisible.value"
      :form="users.createForm.value"
      :submitting="users.creating.value"
      @close="users.closeCreate"
      @update:phone="users.setCreatePhone"
      @submit="createUser"
    />
    <OperatorGrantDialog
      :visible="operatorActions.grantDialogVisible.value"
      :user="operatorActions.selectedUser.value"
      :form="operatorActions.grantForm.value"
      :submitting="operatorActions.submitting.value"
      @close="operatorActions.closeGrant"
      @update:form="operatorActions.replaceGrantForm"
      @submit="grantOperator"
    />
    <OperatorRevokeDialog
      :visible="operatorActions.revokeDialogVisible.value"
      :user="operatorActions.selectedUser.value"
      :form="operatorActions.revokeForm.value"
      :submitting="operatorActions.submitting.value"
      @close="operatorActions.closeRevoke"
      @update:form="operatorActions.replaceRevokeForm"
      @submit="revokeOperator"
    />
  </AdminPage>
</template>

<style scoped>
.users-page__toolbar {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
}

.users-page__search {
  width: min(100%, 430px);
}

@media (max-width: 720px) {
  .users-page__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .users-page__search {
    width: 100%;
  }
}
</style>
