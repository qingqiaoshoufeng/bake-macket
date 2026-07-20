import { computed, ref } from 'vue';
import type { UserProfileView } from '@bake-mall/contracts';

import { useAuthStore } from '../../../stores/auth.js';
import { captureSession, isCurrentSession } from '../../../stores/session.js';
import { profileFeatureApi } from '../api/index.js';

export function mapProfile(
  view: Awaited<ReturnType<typeof profileFeatureApi.get>>,
  phoneVerified: boolean,
): UserProfileView {
  return {
    id: view.id,
    nickname: view.nickname ?? undefined,
    avatarUrl: view.avatarUrl ?? undefined,
    phone: view.phone ?? undefined,
    phoneVerified,
  };
}

export function useProfile() {
  const auth = useAuthStore();
  const profile = ref<UserProfileView | null>(auth.profile ?? null);
  const loading = ref(false);

  async function load(): Promise<UserProfileView> {
    const session = captureSession();
    loading.value = true;
    try {
      const next = mapProfile(
        await profileFeatureApi.get(),
        Boolean(auth.profile?.phoneVerified),
      );
      if (isCurrentSession(session)) {
        profile.value = next;
        auth.setProfile(next);
      }
      return next;
    } finally {
      if (isCurrentSession(session)) loading.value = false;
    }
  }

  function logout(): void {
    auth.clearSession();
    profile.value = null;
  }

  return {
    data: { profile },
    loading: computed(() => loading.value),
    methods: { load, logout },
  };
}
