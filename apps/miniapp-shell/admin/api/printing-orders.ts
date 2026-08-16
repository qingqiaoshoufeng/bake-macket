import type {
  AdminOrderListQuery,
  AdminOrderListResult,
  AppendPrintBatchRequest,
  AppendPrintBatchResult,
  CloudPrinterListQuery,
  CloudPrinterListResult,
  CreatePrintBatchRequest,
  CreatePrintBatchResult,
  CreateSinglePrintRequest,
  CreateSinglePrintResult,
  CurrentCloudPrinterView,
  FailedPrintRetryRequest,
  FailedPrintRetryResult,
  ManualPrintResolutionRequest,
  ManualPrintResolutionResult,
  PrintJobListQuery,
  PrintJobListResult,
  ProcessPrintBatchResult,
  QueryUnknownPrintJobResult,
  SealPrintBatchResult,
} from '@bake-mall/contracts';

import type { BakeMallAppData } from '../../app.js';
import { createMiniappApiClient } from '../../utils/api-client.js';

type ApiRequest = NonNullable<
  Parameters<typeof createMiniappApiClient>[0]['request']
>;

function writeOptions(idempotencyKey: string) {
  return {
    audience: 'admin' as const,
    header: { 'Idempotency-Key': idempotencyKey },
  };
}

export function createPrintingOrdersApi(
  app: BakeMallAppData,
  request?: ApiRequest,
  baseUrl?: string,
) {
  const client = createMiniappApiClient({
    adminSession: app.adminSession,
    customerSession: app.customerSession,
    ...(request ? { request } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });

  return {
    listOrders(query: AdminOrderListQuery): Promise<AdminOrderListResult> {
      return client.get('/admin/orders', { audience: 'admin', query });
    },
    listPrinters(
      query: CloudPrinterListQuery,
    ): Promise<CloudPrinterListResult> {
      return client.get('/admin/cloud-printers', {
        audience: 'admin',
        query: {
          page: query.page,
          pageSize: query.pageSize,
          ...(query.includeUnbound === undefined
            ? {}
            : { includeUnbound: String(query.includeUnbound) }),
        },
      });
    },
    getCurrentPrinter(): Promise<CurrentCloudPrinterView> {
      return client.get('/admin/cloud-printers/current', { audience: 'admin' });
    },
    listJobs(query: PrintJobListQuery): Promise<PrintJobListResult> {
      return client.get('/admin/print-jobs', { audience: 'admin', query });
    },
    createSingle(
      body: CreateSinglePrintRequest,
      idempotencyKey: string,
    ): Promise<CreateSinglePrintResult> {
      return client.post(
        '/admin/print-jobs/single',
        body,
        writeOptions(idempotencyKey),
      );
    },
    createBatch(
      body: CreatePrintBatchRequest,
      idempotencyKey: string,
    ): Promise<CreatePrintBatchResult> {
      return client.post(
        '/admin/print-jobs/batches',
        body,
        writeOptions(idempotencyKey),
      );
    },
    appendBatch(
      batchId: string,
      body: AppendPrintBatchRequest,
      idempotencyKey: string,
    ): Promise<AppendPrintBatchResult> {
      return client.post(
        `/admin/print-jobs/batches/${batchId}/jobs`,
        body,
        writeOptions(idempotencyKey),
      );
    },
    sealBatch(
      batchId: string,
      idempotencyKey: string,
    ): Promise<SealPrintBatchResult> {
      return client.post(
        `/admin/print-jobs/batches/${batchId}/seal`,
        {},
        writeOptions(idempotencyKey),
      );
    },
    processBatch(
      batchId: string,
      idempotencyKey: string,
    ): Promise<ProcessPrintBatchResult> {
      return client.post(
        `/admin/print-jobs/batches/${batchId}/process`,
        {},
        writeOptions(idempotencyKey),
      );
    },
    queryUnknown(
      jobId: string,
      idempotencyKey: string,
    ): Promise<QueryUnknownPrintJobResult> {
      return client.post(
        `/admin/print-jobs/${jobId}/query-unknown`,
        {},
        writeOptions(idempotencyKey),
      );
    },
    retryFailed(
      jobId: string,
      body: FailedPrintRetryRequest,
      idempotencyKey: string,
    ): Promise<FailedPrintRetryResult> {
      return client.post(
        `/admin/print-jobs/${jobId}/retry-failed`,
        body,
        writeOptions(idempotencyKey),
      );
    },
    resolveManual(
      jobId: string,
      body: ManualPrintResolutionRequest,
      idempotencyKey: string,
    ): Promise<ManualPrintResolutionResult> {
      return client.post(
        `/admin/print-jobs/${jobId}/manual-resolution`,
        body,
        writeOptions(idempotencyKey),
      );
    },
  } as const;
}

export type PrintingOrdersApi = ReturnType<typeof createPrintingOrdersApi>;
