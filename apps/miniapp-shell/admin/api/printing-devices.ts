import type {
  BindCloudPrinterRequest,
  BindCloudPrinterResult,
  ClearCurrentCloudPrinterRequest,
  ClearCurrentCloudPrinterResult,
  CloudPrinterListQuery,
  CloudPrinterListResult,
  ConfirmCloudPrinterCompensationDeletionRequest,
  ConfirmCloudPrinterCompensationDeletionResult,
  ConfirmCloudPrinterRequest,
  ConfirmCloudPrinterResult,
  CurrentCloudPrinterView,
  RefreshCloudPrinterOnlineStatusRequest,
  RefreshCloudPrinterOnlineStatusResult,
  RenameCloudPrinterRequest,
  RenameCloudPrinterResult,
  RequeryCloudPrinterVendorRelationRequest,
  RequeryCloudPrinterVendorRelationResult,
  ResendCloudPrinterVerificationRequest,
  ResendCloudPrinterVerificationResult,
  SetCurrentCloudPrinterRequest,
  SetCurrentCloudPrinterResult,
  UnbindCloudPrinterRequest,
  UnbindCloudPrinterResult,
} from '@bake-mall/contracts';

import type { BakeMallAppData } from '../../app.js';
import {
  createMiniappApiClient,
  type MiniappApiRequestOptions,
} from '../../utils/api-client.js';

function headers(idempotencyKey: string): Readonly<Record<string, string>> {
  return { 'Idempotency-Key': idempotencyKey };
}

type ApiRequest = NonNullable<
  Parameters<typeof createMiniappApiClient>[0]['request']
>;

export function createPrintingDevicesApi(
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
  function writeOptions(idempotencyKey: string): MiniappApiRequestOptions {
    return {
      audience: 'admin',
      header: headers(idempotencyKey),
    };
  }

  return {
    list(query: CloudPrinterListQuery): Promise<CloudPrinterListResult> {
      return client.get('/admin/cloud-printers', {
        audience: 'admin',
        query: {
          page: query.page,
          pageSize: query.pageSize,
          ...(query.includeUnbound === undefined
            ? {}
            : { includeUnbound: String(query.includeUnbound) }),
          ...(query.status === undefined ? {} : { status: query.status }),
        },
      });
    },
    detail(printerId: string): Promise<import('@bake-mall/contracts').CloudPrinterView> {
      return client.get(`/admin/cloud-printers/${printerId}`, {
        audience: 'admin',
      });
    },
    current(): Promise<CurrentCloudPrinterView> {
      return client.get('/admin/cloud-printers/current', { audience: 'admin' });
    },
    setCurrent(
      body: SetCurrentCloudPrinterRequest,
      idempotencyKey: string,
    ): Promise<SetCurrentCloudPrinterResult> {
      return client.put(
        '/admin/cloud-printers/current',
        body,
        writeOptions(idempotencyKey),
      );
    },
    clearCurrent(
      body: ClearCurrentCloudPrinterRequest,
      idempotencyKey: string,
    ): Promise<ClearCurrentCloudPrinterResult> {
      return client.post(
        '/admin/cloud-printers/current/clear',
        body,
        writeOptions(idempotencyKey),
      );
    },
    bind(
      body: BindCloudPrinterRequest,
      idempotencyKey: string,
    ): Promise<BindCloudPrinterResult> {
      return client.post(
        '/admin/cloud-printers/bind',
        body,
        writeOptions(idempotencyKey),
      );
    },
    confirm(
      printerId: string,
      body: ConfirmCloudPrinterRequest,
      idempotencyKey: string,
    ): Promise<ConfirmCloudPrinterResult> {
      return client.post(
        `/admin/cloud-printers/${printerId}/verification/confirm`,
        body,
        writeOptions(idempotencyKey),
      );
    },
    resend(
      printerId: string,
      body: ResendCloudPrinterVerificationRequest,
      idempotencyKey: string,
    ): Promise<ResendCloudPrinterVerificationResult> {
      return client.post(
        `/admin/cloud-printers/${printerId}/verification/resend`,
        body,
        writeOptions(idempotencyKey),
      );
    },
    refresh(
      printerId: string,
      body: RefreshCloudPrinterOnlineStatusRequest,
      idempotencyKey: string,
    ): Promise<RefreshCloudPrinterOnlineStatusResult> {
      return client.post(
        `/admin/cloud-printers/${printerId}/online-status/refresh`,
        body,
        writeOptions(idempotencyKey),
      );
    },
    requery(
      printerId: string,
      body: RequeryCloudPrinterVendorRelationRequest,
      idempotencyKey: string,
    ): Promise<RequeryCloudPrinterVendorRelationResult> {
      return client.post(
        `/admin/cloud-printers/${printerId}/vendor-relation/requery`,
        body,
        writeOptions(idempotencyKey),
      );
    },
    confirmDeletion(
      printerId: string,
      body: ConfirmCloudPrinterCompensationDeletionRequest,
      idempotencyKey: string,
    ): Promise<ConfirmCloudPrinterCompensationDeletionResult> {
      return client.post(
        `/admin/cloud-printers/${printerId}/compensation-delete/confirm`,
        body,
        writeOptions(idempotencyKey),
      );
    },
    unbind(
      printerId: string,
      body: UnbindCloudPrinterRequest,
      idempotencyKey: string,
    ): Promise<UnbindCloudPrinterResult> {
      return client.post(
        `/admin/cloud-printers/${printerId}/unbind`,
        body,
        writeOptions(idempotencyKey),
      );
    },
    rename(
      printerId: string,
      body: RenameCloudPrinterRequest,
      idempotencyKey: string,
    ): Promise<RenameCloudPrinterResult> {
      return client.patch(
        `/admin/cloud-printers/${printerId}/display-name`,
        body,
        writeOptions(idempotencyKey),
      );
    },
  } as const;
}
