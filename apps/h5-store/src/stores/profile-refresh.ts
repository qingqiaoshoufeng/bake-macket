import { defineStore } from 'pinia';

import { customerApi } from '../api/customer.js';
import { mapProfile } from '../views/profile/type/mapper.js';
import { useAuthStore } from './auth.js';
import { captureSession, isCurrentSession } from './session.js';

type ProfileRefreshState = {
  error: string | null;
  status: 'failed' | 'idle' | 'refreshing';
};

export const useProfileRefreshStore = defineStore('profile-refresh', {
  state: (): ProfileRefreshState => ({ error: null, status: 'idle' }),
  actions: {
    async refresh(): Promise<boolean> {
      if (this.status === 'refreshing') return false;
      const session = captureSession();
      this.status = 'refreshing';
      this.error = null;
      try {
        const profile = mapProfile(await customerApi.getMe());
        if (!isCurrentSession(session)) {
          this.status = 'idle';
          return false;
        }
        useAuthStore().setProfile(profile);
        this.status = 'idle';
        return true;
      } catch {
        if (!isCurrentSession(session)) {
          this.status = 'idle';
          return false;
        }
        this.status = 'failed';
        this.error = '资料刷新失败，请重试';
        return false;
      }
    },
    retry(): Promise<boolean> {
      return this.refresh();
    },
  },
});
