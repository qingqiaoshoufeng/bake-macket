import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { FakeXpyunServer } from './fake-xpyun-server.js';

describe('FakeXpyunServer', () => {
  const servers: FakeXpyunServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  async function startServer(): Promise<FakeXpyunServer> {
    const server = await FakeXpyunServer.start();
    servers.push(server);
    return server;
  }

  it('records JSON requests and serves queued vendor responses', async () => {
    const server = await startServer();
    server.enqueueJson({ code: 0, msg: 'ok', data: 'job-1' });

    const response = await fetch(
      `${server.baseUrl}/api/openapi/xprinter/print`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({
          sn: 'SN-1',
          content: 'receipt',
          copies: 1,
          voice: 1,
          mode: 0,
          idempotent: 'job-1',
        }),
      },
    );

    await expect(response.json()).resolves.toEqual({
      code: 0,
      msg: 'ok',
      data: 'job-1',
    });
    expect(server.lastRequest()).toMatchObject({
      method: 'POST',
      path: '/api/openapi/xprinter/print',
      body: {
        sn: 'SN-1',
        content: 'receipt',
        copies: 1,
        voice: 1,
        mode: 0,
        idempotent: 'job-1',
      },
    });
  });

  it('implements the five adapter operations with duplicate-safe programmable state', async () => {
    const server = await startServer();
    const signedBody = (body: Readonly<Record<string, unknown>>) => ({
      ...body,
      user: 'developer',
      timestamp: '1786080000',
      sign: createHash('sha1')
        .update('developertop-secret-key1786080000', 'utf8')
        .digest('hex'),
    });
    const post = (path: string, body: Readonly<Record<string, unknown>>) =>
      fetch(`${server.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify(signedBody(body)),
      }).then(async (response) => response.json());

    server.configureVendor({ user: 'developer', userKey: 'top-secret-key' });

    await expect(
      post('/api/openapi/xprinter/addPrinters', {
        items: [{ sn: 'SN-1', name: '前台' }],
        debug: '0',
      }),
    ).resolves.toMatchObject({ code: 0, data: { success: ['SN-1'] } });
    await expect(
      post('/api/openapi/xprinter/addPrinters', {
        items: [{ sn: 'SN-1', name: '前台' }],
        debug: '0',
      }),
    ).resolves.toMatchObject({
      code: 0,
      data: { fail: ['SN-1'], failMsg: ['SN-1:1011'] },
    });
    await expect(
      post('/api/openapi/xprinter/queryPrinterStatus', { sn: 'SN-1' }),
    ).resolves.toMatchObject({ code: 0, data: 1 });
    const printed = (await post('/api/openapi/xprinter/print', {
      sn: 'SN-1',
      content: 'ownership-code:123456',
      copies: 1,
      voice: 1,
      mode: 0,
      idempotent: 'challenge-1',
    })) as { data: string };
    await expect(
      post('/api/openapi/xprinter/print', {
        sn: 'SN-1',
        content: 'ownership-code:123456',
        copies: 1,
        voice: 1,
        mode: 0,
        idempotent: 'challenge-1',
      }),
    ).resolves.toEqual({ code: 1013, msg: 'ORDER_IDEMPOTENT', data: null });
    await expect(
      post('/api/openapi/xprinter/queryOrderState', {
        orderId: printed.data,
      }),
    ).resolves.toMatchObject({ code: 0, data: true });
    await expect(
      post('/api/openapi/xprinter/delPrinters', { snlist: ['SN-1'] }),
    ).resolves.toMatchObject({ code: 0, data: { success: ['SN-1'] } });

    expect(server.requests()).toHaveLength(7);
    expect(JSON.stringify(server.requests())).not.toContain('top-secret-key');
  });

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
  ] as const)('rejects unqueryable order id %j', async (orderId) => {
    const server = await startServer();

    const response = await fetch(
      `${server.baseUrl}/api/openapi/xprinter/queryOrderState`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({ orderId }),
      },
    );

    await expect(response.json()).resolves.toEqual({
      code: -2,
      msg: 'REQUEST_PARAM_INVALID',
      data: null,
    });
  });

  it('supports explicit vendor rejection, HTTP error, timeout, disconnect, non-JSON, invalid schema and throttling', async () => {
    const server = await startServer();
    server.enqueueJson({ code: 1002, msg: 'PRINTER_NOT_REGISTER', data: null });
    server.enqueueJson({ code: 0, msg: 'ok', data: true }, 500);
    server.enqueueTimeout();
    server.enqueueDisconnect();
    server.enqueueText('not-json');
    server.enqueueJson({ unexpected: true });
    server.enqueueJson({ code: 0, msg: 'ok', data: true }, 429);

    const request = (signal?: AbortSignal) =>
      fetch(`${server.baseUrl}/api/openapi/xprinter/queryOrderState`, {
        method: 'POST',
        body: JSON.stringify({ orderId: 'vendor-job-1' }),
        signal,
      });

    await expect(
      request().then((response) => response.json()),
    ).resolves.toMatchObject({
      code: 1002,
    });
    await expect(request()).resolves.toMatchObject({ status: 500 });
    await expect(request(AbortSignal.timeout(20))).rejects.toThrow();
    await expect(request()).rejects.toThrow();
    await expect(request().then((response) => response.text())).resolves.toBe(
      'not-json',
    );
    await expect(
      request().then((response) => response.json()),
    ).resolves.toEqual({
      unexpected: true,
    });
    await expect(request()).resolves.toMatchObject({ status: 429 });
  });

  it('supports association status, ownership-print failure and delete compensation', async () => {
    const server = await startServer();
    server.seedPrinter('SN-COMPENSATE', 0);
    server.setPrinterOnlineStatus('SN-COMPENSATE', 2);
    server.failNextOwnershipPrint('1004');

    const post = (path: string, body: Readonly<Record<string, unknown>>) =>
      fetch(`${server.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify(body),
      }).then(async (response) => response.json());

    await expect(
      post('/api/openapi/xprinter/queryPrinterStatus', {
        sn: 'SN-COMPENSATE',
      }),
    ).resolves.toMatchObject({ code: 0, data: 2 });
    await expect(
      post('/api/openapi/xprinter/print', {
        sn: 'SN-COMPENSATE',
        content: 'ownership-code:654321',
        copies: 1,
        voice: 1,
        mode: 0,
        idempotent: 'challenge-compensate',
      }),
    ).resolves.toMatchObject({ code: 1004, msg: 'ADD_ORDER_FAILED' });
    await expect(
      post('/api/openapi/xprinter/delPrinters', {
        snlist: ['SN-COMPENSATE'],
      }),
    ).resolves.toMatchObject({
      code: 0,
      data: { success: ['SN-COMPENSATE'] },
    });
    await expect(
      post('/api/openapi/xprinter/queryPrinterStatus', {
        sn: 'SN-COMPENSATE',
      }),
    ).resolves.toMatchObject({ code: 1002, msg: 'PRINTER_NOT_REGISTER' });
  });

  it('rejects invalid signatures without recording UserKEY or accepting leaked key fields', async () => {
    const server = await startServer();
    server.configureVendor({ user: 'developer', userKey: 'top-secret-key' });

    const response = await fetch(
      `${server.baseUrl}/api/openapi/xprinter/queryPrinterStatus`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({
          user: 'developer',
          timestamp: '1786080000',
          sign: 'bad-signature',
          UserKEY: 'top-secret-key',
          sn: 'SN-1',
        }),
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      code: -3,
      msg: 'REQUEST_SIGN_FAILED',
    });
    expect(server.lastRequest().body).not.toHaveProperty('UserKEY');
    expect(JSON.stringify(server.requests())).not.toContain('top-secret-key');
  });

  it.each(['success', 'fault', 'timeout', 'disconnect'] as const)(
    'authenticates before dispatching a queued %s response',
    async (mode) => {
      const server = await startServer();
      const user = 'developer';
      const userKey = 'top-secret-key';
      const timestamp = '1786080000';
      const sign = createHash('sha1')
        .update(`${user}${userKey}${timestamp}`, 'utf8')
        .digest('hex');
      server.configureVendor({ user, userKey });
      if (mode === 'success') {
        server.enqueueJson({ code: 0, msg: 'queued-success', data: 1 });
      } else if (mode === 'fault') {
        server.enqueueJson(
          { code: 1001, msg: 'queued-fault', data: null },
          503,
        );
      } else if (mode === 'timeout') {
        server.enqueueTimeout();
      } else {
        server.enqueueDisconnect();
      }

      const request = (requestSign: string, signal?: AbortSignal) =>
        fetch(`${server.baseUrl}/api/openapi/xprinter/queryPrinterStatus`, {
          method: 'POST',
          headers: { 'content-type': 'application/json;charset=UTF-8' },
          body: JSON.stringify({
            user,
            timestamp,
            sign: requestSign,
            sn: 'SN-1',
          }),
          signal,
        });

      const rejected = await request('bad-signature');
      const rejectedText = await rejected.text();
      expect(rejected.status).toBe(200);
      expect(JSON.parse(rejectedText)).toMatchObject({
        code: -3,
        msg: 'REQUEST_SIGN_FAILED',
      });
      expect(rejectedText).not.toContain(sign);
      expect(rejectedText).not.toContain(userKey);

      if (mode === 'success') {
        await expect(
          request(sign).then((response) => response.json()),
        ).resolves.toEqual({
          code: 0,
          msg: 'queued-success',
          data: 1,
        });
      } else if (mode === 'fault') {
        const response = await request(sign);
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
          code: 1001,
          msg: 'queued-fault',
          data: null,
        });
      } else if (mode === 'timeout') {
        await expect(request(sign, AbortSignal.timeout(20))).rejects.toThrow();
      } else {
        await expect(request(sign)).rejects.toThrow();
      }
    },
  );

  it.each([
    {
      method: 'addPrinter',
      path: '/api/openapi/xprinter/addPrinters',
      invalidBody: { items: [{ sn: 'SN-1', name: 1 }], debug: '0' },
      validBody: { items: [{ sn: 'SN-1', name: '前台' }], debug: '0' },
    },
    {
      method: 'deletePrinter',
      path: '/api/openapi/xprinter/delPrinters',
      invalidBody: { snlist: 'SN-1' },
      validBody: { snlist: ['SN-1'] },
    },
    {
      method: 'queryPrinterStatus',
      path: '/api/openapi/xprinter/queryPrinterStatus',
      invalidBody: { sn: 1 },
      validBody: { sn: 'SN-1' },
    },
    {
      method: 'printLabel',
      path: '/api/openapi/xprinter/print',
      invalidBody: {
        sn: 'SN-1',
        content: 'receipt',
        copies: 1,
        voice: 0,
        mode: 0,
        idempotent: 'job-1',
      },
      validBody: {
        sn: 'SN-1',
        content: 'receipt',
        copies: 1,
        voice: 1,
        mode: 0,
        idempotent: 'job-1',
      },
    },
    {
      method: 'queryOrder',
      path: '/api/openapi/xprinter/queryOrderState',
      invalidBody: { orderId: 1 },
      validBody: { orderId: 'vendor-job-1' },
    },
  ] as const)(
    'validates $method fields before consuming a queued response',
    async ({ path, invalidBody, validBody }) => {
      const server = await startServer();
      const user = 'developer';
      const userKey = 'top-secret-key';
      const timestamp = '1786080000';
      const sign = createHash('sha1')
        .update(`${user}${userKey}${timestamp}`, 'utf8')
        .digest('hex');
      const post = (body: Readonly<Record<string, unknown>>) =>
        fetch(`${server.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json;charset=UTF-8' },
          body: JSON.stringify({ ...body, user, timestamp, sign }),
        });
      server.configureVendor({ user, userKey });
      server.enqueueJson({ code: 0, msg: 'queued-success', data: 'sentinel' });

      const invalidResponse = await post(invalidBody);
      const invalidText = await invalidResponse.text();
      expect(invalidResponse.status).toBe(200);
      expect(JSON.parse(invalidText)).toEqual({
        code: -2,
        msg: 'REQUEST_PARAM_INVALID',
        data: null,
      });
      expect(invalidText.includes(sign)).toBe(false);
      expect(invalidText.includes(userKey)).toBe(false);

      await expect(
        post(validBody).then((response) => response.json()),
      ).resolves.toEqual({ code: 0, msg: 'queued-success', data: 'sentinel' });
    },
  );

  it('validates body schema before consuming a queued response', async () => {
    const server = await startServer();
    const user = 'developer';
    const userKey = 'top-secret-key';
    const timestamp = '1786080000';
    const sign = createHash('sha1')
      .update(`${user}${userKey}${timestamp}`, 'utf8')
      .digest('hex');
    server.configureVendor({ user, userKey });
    server.enqueueJson({ code: 0, msg: 'queued-success', data: 1 });

    const invalidResponse = await fetch(
      `${server.baseUrl}/api/openapi/xprinter/queryPrinterStatus`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify([]),
      },
    );
    const invalidText = await invalidResponse.text();
    expect(invalidResponse.status).toBe(400);
    expect(invalidText).not.toContain(sign);
    expect(invalidText).not.toContain(userKey);

    await expect(
      fetch(`${server.baseUrl}/api/openapi/xprinter/queryPrinterStatus`, {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({ user, timestamp, sign, sn: 'SN-1' }),
      }).then((response) => response.json()),
    ).resolves.toEqual({ code: 0, msg: 'queued-success', data: 1 });
  });
});
