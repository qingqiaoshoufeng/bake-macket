import type {
  AdminOrderListItem,
  CloudPrinterView,
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
  selectedOrderIds: readonly string[];
  selectedPrinterId: string | null;
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  result: PrintingResultSummary | null;
}>;
