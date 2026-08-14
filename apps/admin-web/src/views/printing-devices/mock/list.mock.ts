import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
} from '@bake-mall/contracts';

import type { CloudPrinterListResult } from '../type/index.js';

export const PRINTING_DEVICE_LIST_MOCK: CloudPrinterListResult = {
  items: [
    {
      id: '1001',
      displayName: '前台出单机',
      serialNumberMasked: 'SN****01',
      status: CloudPrinterStatus.ACTIVE,
      onlineStatus: CloudPrinterOnlineStatus.ONLINE,
      lastStatusCheckedAt: '2026-08-09T10:00:00.000Z',
      bindingStage: PrinterBindingStage.NONE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};
