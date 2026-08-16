import type { CloudPrinterListResult } from '@bake-mall/contracts';

import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
} from '../../config/contracts.generated.js';

export const PRINTING_DEVICES_MOCK: CloudPrinterListResult = Object.freeze({
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
      isCurrent: true,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
});
