import type {
  BindCloudPrinterRequest,
  ConfirmCloudPrinterCompensationDeletionRequest,
  ConfirmCloudPrinterRequest,
  RefreshCloudPrinterOnlineStatusRequest,
  RenameCloudPrinterRequest,
  RequeryCloudPrinterVendorRelationRequest,
  ResendCloudPrinterVerificationRequest,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { printingDevicesApi } from './index.js';

const key = '123e4567-e89b-42d3-a456-426614174000';
const bindBody: BindCloudPrinterRequest = {
  serialNumber: 'SN-1001',
  displayName: '出单机',
  operationPassword: 'secret',
};
const confirmBody: ConfirmCloudPrinterRequest = {
  challengeId: '1001',
  code: '123456',
  operationPassword: 'secret',
};
const resendBody: ResendCloudPrinterVerificationRequest = {
  operationPassword: 'secret',
};
const refreshBody: RefreshCloudPrinterOnlineStatusRequest = {};
const requeryBody: RequeryCloudPrinterVendorRelationRequest = {
  operationPassword: 'secret',
};
const deleteBody: ConfirmCloudPrinterCompensationDeletionRequest = {
  operationPassword: 'secret',
};
const renameBody: RenameCloudPrinterRequest = { displayName: '前台打印机' };

function jsonResponse(): Response {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('printingDevicesApi', () => {
  it('composes the exact list route with the shared list query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse());
    vi.stubGlobal('fetch', fetchMock);

    await printingDevicesApi.list({
      page: 2,
      pageSize: 50,
      includeUnbound: true,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/admin/cloud-printers?page=2&pageSize=50&includeUnbound=true',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('passes every shared write DTO unchanged and sends the lowercase UUID through the actual fetch headers', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse()));
    vi.stubGlobal('fetch', fetchMock);

    await printingDevicesApi.bind(bindBody, key);
    await printingDevicesApi.confirm('1001', confirmBody, key);
    await printingDevicesApi.resend('1001', resendBody, key);
    await printingDevicesApi.refresh('1001', refreshBody, key);
    await printingDevicesApi.requery('1001', requeryBody, key);
    await printingDevicesApi.confirmDeletion('1001', deleteBody, key);
    await printingDevicesApi.rename('1001', renameBody, key);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/admin/cloud-printers/bind',
      '/api/v1/admin/cloud-printers/1001/verification/confirm',
      '/api/v1/admin/cloud-printers/1001/verification/resend',
      '/api/v1/admin/cloud-printers/1001/online-status/refresh',
      '/api/v1/admin/cloud-printers/1001/vendor-relation/requery',
      '/api/v1/admin/cloud-printers/1001/compensation-delete/confirm',
      '/api/v1/admin/cloud-printers/1001/display-name',
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      'POST',
      'POST',
      'POST',
      'POST',
      'POST',
      'POST',
      'PATCH',
    ]);
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => new Headers(init?.headers).get('Idempotency-Key') === key,
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body))),
    ).toEqual([
      bindBody,
      confirmBody,
      resendBody,
      refreshBody,
      requeryBody,
      deleteBody,
      renameBody,
    ]);
  });
});
