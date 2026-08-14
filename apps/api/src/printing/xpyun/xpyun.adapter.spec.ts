import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FakeXpyunServer,
  type FakeXpyunRequest,
} from '../../../test/fakes/fake-xpyun-server.js';
import { XpyunAdapter } from './xpyun.adapter.js';

const USER = 'developer';
const USER_KEY = 'top-secret-key';
const NOW_MS = 1_786_080_000_000;
const TIMESTAMP = '1786080000';

function createAdapter(
  baseUrl: string,
  options: Readonly<{
    timeoutMs?: number;
    logger?: { warn: ReturnType<typeof vi.fn> };
  }> = {},
): XpyunAdapter {
  return new XpyunAdapter(
    {
      get: vi.fn().mockReturnValue({
        XPYUN_USER: USER,
        XPYUN_USER_KEY: USER_KEY,
        XPYUN_BASE_URL: baseUrl,
        XPYUN_TIMEOUT_MS: options.timeoutMs ?? 1_000,
      }),
    } as never,
    fetch,
    () => NOW_MS,
    (options.logger ?? { warn: vi.fn() }) as never,
  );
}

function expectedSign(): string {
  return createHash('sha1')
    .update(`${USER}${USER_KEY}${TIMESTAMP}`, 'utf8')
    .digest('hex');
}

function expectAuthentication(request: FakeXpyunRequest): void {
  expect(request.body).toMatchObject({
    user: USER,
    timestamp: TIMESTAMP,
    sign: expectedSign(),
  });
  expect(request.body.sign).toMatch(/^[a-f0-9]{40}$/u);
  expect(JSON.stringify(request.body)).not.toContain(USER_KEY);
  expect(request.headers['content-type']).toContain('application/json');
}

describe('XpyunAdapter', () => {
  const servers: FakeXpyunServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
    vi.restoreAllMocks();
  });

  async function startServer(): Promise<FakeXpyunServer> {
    const server = await FakeXpyunServer.start();
    server.configureVendor({ user: USER, userKey: USER_KEY });
    servers.push(server);
    return server;
  }

  it('signs addPrinters without exposing UserKEY and parses a strict success', async () => {
    const server = await startServer();
    server.enqueueJson({
      code: 0,
      msg: 'ok',
      data: { success: ['SN-AbC'], fail: [], failMsg: [] },
    });
    const adapter = createAdapter(server.baseUrl);

    await expect(
      adapter.addPrinter({ serialNumber: 'SN-AbC', displayName: '前台' }),
    ).resolves.toEqual({ vendorCode: '0', vendorMessage: 'ok' });

    const request = server.lastRequest();
    expect(request.path).toBe('/api/openapi/xprinter/addPrinters');
    expect(request.body).toMatchObject({
      items: [{ sn: 'SN-AbC', name: '前台' }],
      debug: '0',
    });
    expectAuthentication(request);
  });

  it('uses the documented endpoints for delete, online status, print and order query', async () => {
    const server = await startServer();
    server.enqueueJson({
      code: 0,
      msg: 'deleted',
      data: { success: ['SN-1'], fail: [], failMsg: [] },
    });
    server.enqueueJson({ code: 0, msg: 'ok', data: 1 });
    server.enqueueJson({ code: 0, msg: 'accepted', data: 'vendor-job-1' });
    server.enqueueJson({ code: 0, msg: 'printed', data: true });
    const adapter = createAdapter(server.baseUrl);

    await expect(adapter.deletePrinter('SN-1')).resolves.toMatchObject({
      vendorCode: '0',
    });
    await expect(adapter.queryOnline('SN-1')).resolves.toEqual({
      status: 'ONLINE',
      vendorCode: '0',
    });
    await expect(
      adapter.print({
        serialNumber: 'SN-1',
        content: 'ownership-code:123456',
        tradeOrderId: 'challenge-1',
      }),
    ).resolves.toEqual({
      classification: 'ACCEPTED',
      vendorCode: '0',
      vendorJobId: 'vendor-job-1',
    });
    await expect(adapter.queryOrder('vendor-job-1')).resolves.toEqual({
      printed: true,
      vendorCode: '0',
    });

    expect(server.requests().map(({ path }) => path)).toEqual([
      '/api/openapi/xprinter/delPrinters',
      '/api/openapi/xprinter/queryPrinterStatus',
      '/api/openapi/xprinter/print',
      '/api/openapi/xprinter/queryOrderState',
    ]);
    expect(server.requests()[2]?.body).toMatchObject({
      sn: 'SN-1',
      content: 'ownership-code:123456',
      copies: 1,
      voice: 1,
      mode: 0,
      idempotent: 'challenge-1',
    });
    expect(server.requests()[2]?.body).not.toHaveProperty('expiresInSeconds');
    expect(server.requests()[2]?.body).not.toHaveProperty('backurlFlag');
    expect(server.requests()[2]?.body).not.toHaveProperty('payType');
    server.requests().forEach(expectAuthentication);
  });

  it.each([
    [0, 'OFFLINE'],
    [1, 'ONLINE'],
    [2, 'ABNORMAL'],
  ] as const)('maps vendor printer status %s', async (data, status) => {
    const server = await startServer();
    server.enqueueJson({ code: 0, msg: 'ok', data });

    await expect(
      createAdapter(server.baseUrl).queryOnline('SN-1'),
    ).resolves.toEqual({
      status,
      vendorCode: '0',
    });
  });

  it('rejects a string printer status as an unverifiable response', async () => {
    const server = await startServer();
    server.enqueueJson({ code: 0, msg: 'ok', data: '1' });

    await expect(
      createAdapter(server.baseUrl).queryOnline('SN-1'),
    ).rejects.toMatchObject({
      name: 'XpyunAdapterError',
      classification: 'UNKNOWN',
      vendorCode: null,
    });
  });

  it('maps per-printer add failures to FAILED and contradictory lists to UNKNOWN', async () => {
    const server = await startServer();
    server.enqueueJson({
      code: 0,
      msg: 'batch complete',
      data: { success: [], fail: ['SN-1'], failMsg: ['SN-1:1010'] },
    });
    server.enqueueJson({
      code: 0,
      msg: 'ambiguous',
      data: { success: ['SN-1'], fail: ['SN-1'], failMsg: [] },
    });
    const adapter = createAdapter(server.baseUrl);

    await expect(
      adapter.addPrinter({ serialNumber: 'SN-1', displayName: '前台' }),
    ).rejects.toMatchObject({
      classification: 'FAILED',
      vendorCode: '1010',
    });
    await expect(
      adapter.addPrinter({ serialNumber: 'SN-1', displayName: '前台' }),
    ).rejects.toMatchObject({ classification: 'UNKNOWN' });
  });

  it('classifies ORDER_IDEMPOTENT print responses as UNKNOWN because no job id is returned', async () => {
    const server = await startServer();
    server.enqueueJson({ code: 1013, msg: 'ORDER_IDEMPOTENT', data: null });

    await expect(
      createAdapter(server.baseUrl).print({
        serialNumber: 'SN-1',
        content: 'receipt',
        tradeOrderId: 'order-1',
      }),
    ).rejects.toMatchObject({
      name: 'XpyunAdapterError',
      classification: 'UNKNOWN',
      vendorCode: '1013',
    });
  });

  it.each([
    123,
    1.5,
    '',
    '   ',
    ' vendor-job-1',
    'vendor-job-1 ',
    'vendor job 1',
    `vendor-job-1${String.fromCharCode(0)}`,
    `vendor-job-1${String.fromCharCode(10)}Authorization: secret`,
    `vendor-job-1${String.fromCharCode(0x200b)}hidden`,
    'x'.repeat(129),
  ] as const)(
    'classifies untrustworthy accepted print data %j as UNKNOWN',
    async (data) => {
      const server = await startServer();
      server.enqueueJson({ code: 0, msg: 'ok', data });

      await expect(
        createAdapter(server.baseUrl).print({
          serialNumber: 'SN-1',
          content: 'receipt',
          tradeOrderId: 'order-1',
        }),
      ).rejects.toMatchObject({
        name: 'XpyunAdapterError',
        classification: 'UNKNOWN',
        vendorCode: null,
      });
      expect(server.lastRequest().path).toBe('/api/openapi/xprinter/print');
    },
  );

  it.each([
    '',
    ' ',
    ' vendor-job-1',
    'vendor-job-1 ',
    'vendor job 1',
    `vendor-job-1${String.fromCharCode(0)}`,
    `vendor-job-1${String.fromCharCode(10)}Authorization: secret`,
    `vendor-job-1${String.fromCharCode(0x200b)}hidden`,
    'x'.repeat(129),
  ] as const)(
    'rejects unqueryable vendor job id %j before fetch',
    async (vendorJobId) => {
      const fetcher = vi.fn<typeof fetch>();
      const adapter = new XpyunAdapter(
        {
          get: vi.fn().mockReturnValue({
            XPYUN_USER: USER,
            XPYUN_USER_KEY: USER_KEY,
            XPYUN_BASE_URL: 'https://open.xpyun.net',
            XPYUN_TIMEOUT_MS: 1_000,
          }),
        } as never,
        fetcher,
        () => NOW_MS,
      );

      await expect(adapter.queryOrder(vendorJobId)).rejects.toMatchObject({
        name: 'XpyunAdapterError',
        classification: 'VALIDATION_FAILED',
        vendorCode: null,
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('uses the Nest logger by default while emitting only the exact safe failure summary', async () => {
    const server = await startServer();
    server.enqueueJson({
      code: 1002,
      msg: `PRINTER_NOT_REGISTER ${USER_KEY} SN-FULL-SECRET`,
      data: null,
    });
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const adapter = new XpyunAdapter(
      {
        get: vi.fn().mockReturnValue({
          XPYUN_USER: USER,
          XPYUN_USER_KEY: USER_KEY,
          XPYUN_BASE_URL: server.baseUrl,
          XPYUN_TIMEOUT_MS: 1_000,
        }),
      } as never,
      fetch,
      () => NOW_MS,
    );

    await expect(adapter.queryOnline('SN-FULL-SECRET')).rejects.toMatchObject({
      classification: 'FAILED',
      vendorCode: '1002',
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({
      operation: 'queryOnline',
      elapsedMs: 0,
      vendorCode: '1002',
      serialNumberMasked: 'SN**********ET',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /top-secret-key|SN-FULL-SECRET|PRINTER_NOT_REGISTER|UserKEY|sign|raw/iu,
    );
  });

  it('parses both boolean order states and rejects invalid order state data', async () => {
    const server = await startServer();
    server.enqueueJson({ code: 0, msg: 'not printed', data: false });
    server.enqueueJson({ code: 0, msg: 'invalid', data: 'false' });
    const adapter = createAdapter(server.baseUrl);

    await expect(adapter.queryOrder('vendor-job-1')).resolves.toEqual({
      printed: false,
      vendorCode: '0',
    });
    await expect(adapter.queryOrder('vendor-job-1')).rejects.toMatchObject({
      classification: 'UNKNOWN',
    });
  });

  it.each([
    'bogus',
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '',
    ' ',
    ' 1001',
    '1001\n',
    '01',
    '1.5',
    '1e3',
  ] as const)('classifies invalid vendor code %j as UNKNOWN', async (code) => {
    const server = await startServer();
    server.enqueueJson({ code, msg: 'invalid vendor code', data: null });

    await expect(
      createAdapter(server.baseUrl).queryOnline('SN-1'),
    ).rejects.toMatchObject({
      name: 'XpyunAdapterError',
      classification: 'UNKNOWN',
      vendorCode: null,
    });
  });

  it('normalizes a canonical string vendor code before classifying rejection', async () => {
    const server = await startServer();
    server.enqueueJson({ code: '1001', msg: 'rejected', data: null });

    await expect(
      createAdapter(server.baseUrl).queryOnline('SN-1'),
    ).rejects.toMatchObject({
      name: 'XpyunAdapterError',
      classification: 'FAILED',
      vendorCode: '1001',
    });
  });

  it.each([
    [1001, 'SN_USER_NOT_MATCH'],
    [1002, 'PRINTER_NOT_REGISTER'],
    [1022, 'CUSTOM_DEVICE_ACCOUNT_UNAUTHORIZED'],
    [1033, 'ACCOUNT_PRINTER_LIMIT_REACHED'],
    [-4, 'REQUEST_USER_NOT_REGISTER'],
  ] as const)(
    'maps documented vendor rejection %s to FAILED without raw details',
    async (code, message) => {
      const server = await startServer();
      server.enqueueJson({
        code,
        msg: `${message} ${USER_KEY} SN-FULL-SECRET`,
        data: null,
      });
      const adapter = createAdapter(server.baseUrl);

      await expect(
        adapter.addPrinter({
          serialNumber: 'SN-FULL-SECRET',
          displayName: '前台',
        }),
      ).rejects.toMatchObject({
        name: 'XpyunAdapterError',
        classification: 'FAILED',
        vendorCode: String(code),
        message: 'Xpyun rejected the request.',
      });
    },
  );

  it.each([
    ['add already exists', '1011'],
    ['invalid serial number', '1010'],
    ['custom device unavailable to current account', '1022'],
    ['serial number belongs to another account', '1001'],
    ['account printer limit reached', '1033'],
  ] as const)('maps %s item failure to FAILED code %s', async (_case, code) => {
    const server = await startServer();
    server.enqueueJson({
      code: 0,
      msg: 'batch complete',
      data: { success: [], fail: ['SN-1'], failMsg: [`SN-1:${code}`] },
    });

    await expect(
      createAdapter(server.baseUrl).addPrinter({
        serialNumber: 'SN-1',
        displayName: '前台',
      }),
    ).rejects.toMatchObject({ classification: 'FAILED', vendorCode: code });
  });

  it.each(['missing code', 'SN-1:01', 'SN-1:bogus', 'SN-OTHER:1010'] as const)(
    'classifies unverifiable per-printer failure %j as UNKNOWN',
    async (failureMessage) => {
      const server = await startServer();
      server.enqueueJson({
        code: 0,
        msg: 'batch complete',
        data: {
          success: [],
          fail: ['SN-1'],
          failMsg: [failureMessage],
        },
      });

      await expect(
        createAdapter(server.baseUrl).addPrinter({
          serialNumber: 'SN-1',
          displayName: '前台',
        }),
      ).rejects.toMatchObject({
        name: 'XpyunAdapterError',
        classification: 'UNKNOWN',
        vendorCode: null,
      });
    },
  );

  it('rejects an unexpected extra batch outcome as UNKNOWN', async () => {
    const server = await startServer();
    server.enqueueJson({
      code: 0,
      msg: 'batch complete',
      data: {
        success: ['SN-1', 'SN-OTHER'],
        fail: [],
        failMsg: [],
      },
    });

    await expect(
      createAdapter(server.baseUrl).addPrinter({
        serialNumber: 'SN-1',
        displayName: '前台',
      }),
    ).rejects.toMatchObject({
      name: 'XpyunAdapterError',
      classification: 'UNKNOWN',
      vendorCode: null,
    });
  });

  it.each(['non-json', 'invalid-schema'] as const)(
    'classifies %s responses as UNKNOWN',
    async (mode) => {
      const server = await startServer();
      if (mode === 'non-json') server.enqueueText('not-json');
      else
        server.enqueueJson({ code: 0, msg: 'ok', data: { unexpected: true } });
      const adapter = createAdapter(server.baseUrl);

      await expect(adapter.queryOnline('SN-1')).rejects.toMatchObject({
        name: 'XpyunAdapterError',
        classification: 'UNKNOWN',
      });
    },
  );

  it.each([
    [429, 1001, 'SN_USER_NOT_MATCH', 'RATE_LIMITED'],
    [503, 1033, 'ACCOUNT_PRINTER_LIMIT_REACHED', 'UNAVAILABLE'],
  ] as const)(
    'classifies HTTP %s with vendor code %s as %s without logging raw details',
    async (status, code, message, classification) => {
      const server = await startServer();
      const logger = { warn: vi.fn() };
      server.enqueueJson(
        {
          code,
          msg: `${message} ${USER_KEY} SN-FULL-SECRET`,
          data: null,
        },
        status,
      );

      await expect(
        createAdapter(server.baseUrl, { logger }).queryOnline('SN-FULL-SECRET'),
      ).rejects.toMatchObject({
        name: 'XpyunAdapterError',
        classification,
        vendorCode: String(code),
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        operation: 'queryOnline',
        vendorCode: String(code),
        serialNumberMasked: 'SN**********ET',
      });
      expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(
        /top-secret-key|SN-FULL-SECRET|SN_USER_NOT_MATCH|ACCOUNT_PRINTER_LIMIT_REACHED|sign/u,
      );
    },
  );

  it.each([
    ['non-JSON HTTP 500', 'text' as const, 500, 'UNAVAILABLE'],
    ['non-JSON HTTP 503', 'text' as const, 503, 'UNAVAILABLE'],
    ['invalid-schema HTTP 429', 'invalid' as const, 429, 'RATE_LIMITED'],
    ['HTTP 429 success envelope', 'success' as const, 429, 'RATE_LIMITED'],
    ['HTTP 503 success envelope', 'success' as const, 503, 'UNAVAILABLE'],
  ] as const)(
    'classifies %s from the trusted HTTP status',
    async (_case, mode, status, classification) => {
      const server = await startServer();
      if (mode === 'text') server.enqueueText('not-json', status);
      else if (mode === 'invalid')
        server.enqueueJson({ unexpected: true }, status);
      else server.enqueueJson({ code: 0, msg: 'ok', data: 1 }, status);

      await expect(
        createAdapter(server.baseUrl).queryOnline('SN-1'),
      ).rejects.toMatchObject({
        name: 'XpyunAdapterError',
        classification,
        vendorCode: null,
      });
    },
  );

  it.each(['', 'x'.repeat(51)] as const)(
    'rejects invalid print idempotent %j before fetch',
    async (tradeOrderId) => {
      const fetcher = vi.fn<typeof fetch>();
      const adapter = new XpyunAdapter(
        {
          get: vi.fn().mockReturnValue({
            XPYUN_USER: USER,
            XPYUN_USER_KEY: USER_KEY,
            XPYUN_BASE_URL: 'https://open.xpyun.net',
            XPYUN_TIMEOUT_MS: 1_000,
          }),
        } as never,
        fetcher,
        () => NOW_MS,
      );

      await expect(
        adapter.print({
          serialNumber: 'SN-1',
          content: 'receipt',
          tradeOrderId,
        }),
      ).rejects.toMatchObject({
        name: 'XpyunAdapterError',
        classification: 'VALIDATION_FAILED',
        vendorCode: null,
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([307, 308] as const)(
    'classifies HTTP %s redirect as UNKNOWN without sending the signed body to Location',
    async (status) => {
      const server = await startServer();
      const redirectTarget = await startServer();
      const logger = { warn: vi.fn() };
      const location = `${redirectTarget.baseUrl}/api/openapi/xprinter/print`;
      server.enqueueRedirect(location, status);
      redirectTarget.enqueueJson({
        code: 0,
        msg: 'redirected',
        data: 'redirected-job',
      });

      const error = await createAdapter(server.baseUrl, { logger })
        .print({
          serialNumber: 'SN-REDIRECT-SECRET',
          content: 'redirect-sensitive-receipt',
          tradeOrderId: 'redirect-trade-order',
        })
        .then(
          () => null,
          (reason: unknown) => reason,
        );

      expect(server.requests()).toHaveLength(1);
      expectAuthentication(server.lastRequest());
      expect(redirectTarget.requests()).toHaveLength(0);
      expect(error).toMatchObject({
        name: 'XpyunAdapterError',
        classification: 'UNKNOWN',
        vendorCode: null,
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const summary = logger.warn.mock.calls[0]?.[0];
      expect(Object.keys(summary ?? {}).sort()).toEqual([
        'elapsedMs',
        'operation',
        'serialNumberMasked',
        'vendorCode',
      ]);
      expect(JSON.stringify(summary)).not.toMatch(
        new RegExp(
          [
            'location',
            'sign',
            'body',
            location,
            expectedSign(),
            'SN-REDIRECT-SECRET',
            'redirect-sensitive-receipt',
            'redirect-trade-order',
          ]
            .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
            .join('|'),
          'iu',
        ),
      );
    },
  );

  it('classifies a connection interruption as UNKNOWN without replaying', async () => {
    const server = await startServer();
    server.enqueueDisconnect();
    const adapter = createAdapter(server.baseUrl);

    await expect(adapter.queryOnline('SN-1')).rejects.toMatchObject({
      name: 'XpyunAdapterError',
      classification: 'UNKNOWN',
    });
    expect(server.requests()).toHaveLength(1);
  });

  it('classifies timeout as UNKNOWN and logs an exact safe summary', async () => {
    const server = await startServer();
    server.enqueueTimeout();
    const logger = { warn: vi.fn() };
    const adapter = createAdapter(server.baseUrl, { timeoutMs: 20, logger });

    const operation = adapter.deletePrinter('SN-FULL-SECRET');
    await expect(operation).rejects.toMatchObject({
      name: 'XpyunAdapterError',
      classification: 'UNKNOWN',
    });

    expect(server.requests()).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const summary = logger.warn.mock.calls[0]?.[0];
    expect(Object.keys(summary ?? {}).sort()).toEqual([
      'elapsedMs',
      'operation',
      'serialNumberMasked',
      'vendorCode',
    ]);
    expect(summary).toMatchObject({
      operation: 'deletePrinter',
      elapsedMs: 0,
      vendorCode: null,
      serialNumberMasked: 'SN**********ET',
    });
    expect(JSON.stringify(summary)).not.toMatch(
      /top-secret-key|SN-FULL-SECRET|sign|ownership-code/u,
    );
  });
});
