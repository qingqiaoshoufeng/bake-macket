import { ref, type Ref } from 'vue';

import { usersApi } from '../api/index.js';
import type { AdminUserDetailView } from '../type/index.js';

export type UseUserDetailResult = {
  readonly visible: Ref<boolean>;
  readonly detail: Ref<AdminUserDetailView | null>;
  readonly loading: Ref<boolean>;
  readonly error: Ref<string | null>;
  readonly open: (userId: string) => Promise<void>;
  readonly close: () => void;
  readonly retry: () => Promise<void>;
};

export function useUserDetail(): UseUserDetailResult {
  const visible = ref(false);
  const detail = ref<AdminUserDetailView | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let selectedUserId: string | null = null;
  let requestSequence = 0;

  async function load(userId: string): Promise<void> {
    requestSequence += 1;
    const requestId = requestSequence;
    loading.value = true;
    error.value = null;
    try {
      const result = await usersApi.getOne(userId);
      if (requestId === requestSequence) detail.value = result;
    } catch {
      if (requestId === requestSequence) {
        detail.value = null;
        error.value = '用户详情加载失败，请稍后重试';
      }
    } finally {
      if (requestId === requestSequence) loading.value = false;
    }
  }

  async function open(userId: string): Promise<void> {
    selectedUserId = userId;
    detail.value = null;
    visible.value = true;
    await load(userId);
  }

  function close(): void {
    requestSequence += 1;
    visible.value = false;
    selectedUserId = null;
    detail.value = null;
    error.value = null;
    loading.value = false;
  }

  async function retry(): Promise<void> {
    if (!selectedUserId) return;
    await load(selectedUserId);
  }

  return { visible, detail, loading, error, open, close, retry };
}
