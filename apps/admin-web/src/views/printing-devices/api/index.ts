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

import { apiClient } from '../../../api/http.js';

function toSearchParams(query: CloudPrinterListQuery): URLSearchParams {
  return new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, String(value)]),
  );
}

function idempotencyHeaders(idempotencyKey: string): {
  readonly headers: Readonly<Record<'Idempotency-Key', string>>;
} {
  return { headers: { 'Idempotency-Key': idempotencyKey } };
}

export const printingDevicesApi = {
  list(query: CloudPrinterListQuery): Promise<CloudPrinterListResult> {
    return apiClient.get(
      `/admin/cloud-printers?${toSearchParams(query).toString()}`,
    );
  },
  detail(printerId: string): Promise<import('@bake-mall/contracts').CloudPrinterView> {
    return apiClient.get(`/admin/cloud-printers/${printerId}`);
  },
  current(): Promise<CurrentCloudPrinterView> {
    return apiClient.get('/admin/cloud-printers/current');
  },
  setCurrent(
    body: SetCurrentCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<SetCurrentCloudPrinterResult> {
    return apiClient.put(
      '/admin/cloud-printers/current',
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
  clearCurrent(
    body: ClearCurrentCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<ClearCurrentCloudPrinterResult> {
    return apiClient.post(
      '/admin/cloud-printers/current/clear',
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
  bind(
    body: BindCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<BindCloudPrinterResult> {
    return apiClient.post(
      '/admin/cloud-printers/bind',
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
  confirm(
    printerId: string,
    body: ConfirmCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<ConfirmCloudPrinterResult> {
    return apiClient.post(
      `/admin/cloud-printers/${printerId}/verification/confirm`,
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
  resend(
    printerId: string,
    body: ResendCloudPrinterVerificationRequest,
    idempotencyKey: string,
  ): Promise<ResendCloudPrinterVerificationResult> {
    return apiClient.post(
      `/admin/cloud-printers/${printerId}/verification/resend`,
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
  refresh(
    printerId: string,
    body: RefreshCloudPrinterOnlineStatusRequest,
    idempotencyKey: string,
  ): Promise<RefreshCloudPrinterOnlineStatusResult> {
    return apiClient.post(
      `/admin/cloud-printers/${printerId}/online-status/refresh`,
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
  requery(
    printerId: string,
    body: RequeryCloudPrinterVendorRelationRequest,
    idempotencyKey: string,
  ): Promise<RequeryCloudPrinterVendorRelationResult> {
    return apiClient.post(
      `/admin/cloud-printers/${printerId}/vendor-relation/requery`,
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
  confirmDeletion(
    printerId: string,
    body: ConfirmCloudPrinterCompensationDeletionRequest,
    idempotencyKey: string,
  ): Promise<ConfirmCloudPrinterCompensationDeletionResult> {
    return apiClient.post(
      `/admin/cloud-printers/${printerId}/compensation-delete/confirm`,
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
  unbind(
    printerId: string,
    body: UnbindCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<UnbindCloudPrinterResult> {
    return apiClient.post(
      `/admin/cloud-printers/${printerId}/unbind`,
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
  rename(
    printerId: string,
    body: RenameCloudPrinterRequest,
    idempotencyKey: string,
  ): Promise<RenameCloudPrinterResult> {
    return apiClient.patch(
      `/admin/cloud-printers/${printerId}/display-name`,
      body,
      idempotencyHeaders(idempotencyKey),
    );
  },
};
