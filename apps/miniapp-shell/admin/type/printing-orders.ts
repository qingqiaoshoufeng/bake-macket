import type {
  AdminOrderListItem,
  CloudPrinterView,
  CurrentCloudPrinterView,
  PrintBatchView,
  PrintJobView,
} from '@bake-mall/contracts';

export type PrintingOrderRow = AdminOrderListItem &
  Readonly<{
    selected: boolean;
    statusLabel: string;
    fulfillmentLabel: string;
    payableText: string;
  }>;

export type PrintingPrinterOption = CloudPrinterView &
  Readonly<{
    selected: boolean;
    available: boolean;
    current: boolean;
    unavailableReason: string | null;
  }>;

export type PrintingPrinterSelectionSource =
  | 'restored'
  | 'manual'
  | 'current'
  | 'single-available';

export type PrintingPrinterIntent = Readonly<{
  printerId: string;
  printerLabel: string;
  selectionRevision: number;
}>;

export type PrintingJobRow = PrintJobView &
  Readonly<{
    statusLabel: string;
    canQueryUnknown: boolean;
    canRetryFailed: boolean;
    canResolveManually: boolean;
  }>;

export type PrintingResultSummary = Readonly<{
  batch: PrintBatchView;
  jobs: readonly PrintJobView[];
  processedCount: number;
  accepted: number;
  failed: number;
  unknown: number;
  manualReview: number;
}>;

export type PrintingOrdersState = Readonly<{
  orders: readonly AdminOrderListItem[];
  printers: readonly CloudPrinterView[];
  availablePrinters: readonly CloudPrinterView[];
  current: CurrentCloudPrinterView | null;
  selectedOrderIds: readonly string[];
  selectedPrinterId: string | null;
  selectionSource: PrintingPrinterSelectionSource | null;
  rememberedManualPrinterId: string | null;
  selectionMessage: string;
  selectionRevision: number;
  printersLoadedAt: number | null;
  loadSucceeded: boolean;
  selectionReady: boolean;
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  submitting: boolean;
  manualContinueRequired: boolean;
  setupContinueRequired: boolean;
  pendingBatchId: string | null;
  pendingBatchPrinterLabel: string | null;
  pendingOperationKeys: Readonly<Record<string, string>>;
  error: string | null;
  result: PrintingResultSummary | null;
}>;
