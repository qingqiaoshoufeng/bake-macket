import type { AddressView } from '../type/index.js';

export const addressListMock: readonly AddressView[] = [
  {
    id: 'address-demo',
    recipient: '小明',
    phone: '13800000000',
    province: '浙江省',
    city: '杭州市',
    district: '西湖区',
    detail: '文一西路 1 号',
    isDefault: true,
  },
];
