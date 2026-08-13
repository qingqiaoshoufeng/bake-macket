import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

import { startFakeXpyunServer } from '../../scripts/fake-xpyun-server.mjs';

const servers = [];

test.afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function signedBody(body) {
  const user = 'local-xpyun-user';
  const userKey = 'local-xpyun-user-key';
  const timestamp = '1786080000';
  const sign = createHash('sha1')
    .update(`${user}${userKey}${timestamp}`, 'utf8')
    .digest('hex');
  return { ...body, user, timestamp, sign };
}

async function post(server, path, body) {
  return fetch(`http://${server.host}:${server.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedBody(body)),
  }).then((response) => response.json());
}

test('runtime fake Xpyun server supports bind, print and query', async () => {
  const server = await startFakeXpyunServer({
    port: 0,
    logger: { info: () => undefined },
  });
  servers.push(server);

  assert.deepEqual(
    await post(server, '/api/openapi/xprinter/addPrinters', {
      items: [{ sn: 'FAKE-PRINTER-001', name: '测试打印机' }],
      debug: '0',
    }),
    {
      code: 0,
      msg: 'ok',
      data: { success: ['FAKE-PRINTER-001'], fail: [], failMsg: [] },
    },
  );
  assert.deepEqual(
    await post(server, '/api/openapi/xprinter/queryPrinterStatus', {
      sn: 'FAKE-PRINTER-001',
    }),
    { code: 0, msg: 'ok', data: 1 },
  );
  const printed = await post(server, '/api/openapi/xprinter/print', {
    sn: 'FAKE-PRINTER-001',
    content: 'receipt',
    copies: 1,
    voice: 1,
    mode: 0,
    idempotent: 'print-job-1',
  });
  assert.deepEqual(
    await post(server, '/api/openapi/xprinter/queryOrderState', {
      orderId: printed.data,
    }),
    { code: 0, msg: 'ok', data: true },
  );
});
