import { describe, expect, it, vi } from 'vitest';

import { customerApi } from '../../../api/customer.js';
import { profileFeatureApi } from './index.js';

describe('profileFeatureApi', () => {
  it('通过全局 customerApi 读写订单联系手机号', async () => {
    const get = vi.spyOn(customerApi, 'getMe').mockResolvedValue({
      id: 'user-1',
      nickname: null,
      avatarUrl: null,
      phone: null,
      phoneVerified: false,
      orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
    });
    const update = vi
      .spyOn(customerApi, 'updateOrderContactPhone')
      .mockResolvedValue({
        configured: true,
        maskedPhone: '138****0000',
        version: 1,
      });

    await profileFeatureApi.get();
    await profileFeatureApi.updateOrderContactPhone({
      phone: '13800000000',
      expectedVersion: 0,
    });

    expect(get).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      phone: '13800000000',
      expectedVersion: 0,
    });
  });
});
