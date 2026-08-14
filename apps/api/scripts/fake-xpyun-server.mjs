import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 43999;
const DEFAULT_USER = 'local-xpyun-user';
const DEFAULT_USER_KEY = 'local-xpyun-user-key';

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length === 0
    ? {}
    : record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

function respond(response, body) {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json;charset=UTF-8');
  response.end(JSON.stringify(body));
}

function validAuthentication(body, user, userKey) {
  if (body.user !== user || typeof body.timestamp !== 'string') return false;
  const sign = createHash('sha1')
    .update(`${user}${userKey}${body.timestamp}`, 'utf8')
    .digest('hex');
  return body.sign === sign;
}

function masked(value) {
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

export async function startFakeXpyunServer(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const user = options.user ?? DEFAULT_USER;
  const userKey = options.userKey ?? DEFAULT_USER_KEY;
  const logger = options.logger ?? console;
  const printers = new Map();
  const jobs = new Map();
  const idempotentJobs = new Map();
  let nextJob = 1;

  const server = createServer(async (request, response) => {
    try {
      const body = await readBody(request);
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (!body || !validAuthentication(body, user, userKey)) {
        respond(response, { code: -3, msg: 'REQUEST_SIGN_FAILED', data: null });
        return;
      }

      if (path === '/api/openapi/xprinter/addPrinters') {
        const items = Array.isArray(body.items) ? body.items : [];
        const serialNumbers = items
          .map((item) => record(item)?.sn)
          .filter((serialNumber) => typeof serialNumber === 'string');
        serialNumbers.forEach((serialNumber) => printers.set(serialNumber, 1));
        respond(response, {
          code: 0,
          msg: 'ok',
          data: { success: serialNumbers, fail: [], failMsg: [] },
        });
        logger.info({ event: 'fake-xpyun-printers-added', count: serialNumbers.length });
        return;
      }

      if (path === '/api/openapi/xprinter/queryPrinterStatus') {
        const serialNumber = typeof body.sn === 'string' ? body.sn : '';
        const status = printers.get(serialNumber);
        respond(
          response,
          status === undefined
            ? { code: 1002, msg: 'PRINTER_NOT_REGISTER', data: null }
            : { code: 0, msg: 'ok', data: status },
        );
        return;
      }

      if (path === '/api/openapi/xprinter/delPrinters') {
        const serialNumbers = Array.isArray(body.snlist) ? body.snlist : [];
        const success = serialNumbers.filter(
          (serialNumber) => typeof serialNumber === 'string' && printers.delete(serialNumber),
        );
        respond(response, {
          code: 0,
          msg: 'ok',
          data: { success, fail: [], failMsg: [] },
        });
        logger.info({ event: 'fake-xpyun-printers-deleted', count: success.length });
        return;
      }

      if (path === '/api/openapi/xprinter/print') {
        const serialNumber = typeof body.sn === 'string' ? body.sn : '';
        if (!printers.has(serialNumber)) {
          respond(response, { code: 1002, msg: 'PRINTER_NOT_REGISTER', data: null });
          return;
        }
        const idempotent = typeof body.idempotent === 'string' ? body.idempotent : '';
        if (idempotentJobs.has(idempotent)) {
          respond(response, { code: 1013, msg: 'ORDER_IDEMPOTENT', data: null });
          return;
        }
        const jobId = `FAKE-ORDER-${nextJob++}`;
        jobs.set(jobId, true);
        idempotentJobs.set(idempotent, jobId);
        const content = typeof body.content === 'string' ? body.content : '';
        const ownershipCode = content.match(/^ownership-code:(\d{6})$/u)?.[1];
        logger.info(
          ownershipCode
            ? {
                event: 'fake-xpyun-ownership-code',
                printer: masked(serialNumber),
                code: ownershipCode,
              }
            : {
                event: 'fake-xpyun-print-accepted',
                printer: masked(serialNumber),
                vendorJobId: jobId,
              },
        );
        respond(response, { code: 0, msg: 'ok', data: jobId });
        return;
      }

      if (path === '/api/openapi/xprinter/queryOrderState') {
        const orderId = typeof body.orderId === 'string' ? body.orderId : '';
        respond(
          response,
          jobs.has(orderId)
            ? { code: 0, msg: 'ok', data: jobs.get(orderId) }
            : { code: 1005, msg: 'ORDER_NOT_FOUND', data: null },
        );
        return;
      }

      response.statusCode = 404;
      respond(response, { code: -2, msg: 'REQUEST_PARAM_INVALID', data: null });
    } catch {
      response.statusCode = 400;
      response.end('bad request');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = address && typeof address !== 'string' ? address.port : port;
  logger.info({ event: 'fake-xpyun-ready', host, port: actualPort });
  return {
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
    host,
    port: actualPort,
  };
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  const port = Number(process.env.FAKE_XPYUN_PORT ?? DEFAULT_PORT);
  const service = await startFakeXpyunServer({
    host: process.env.FAKE_XPYUN_HOST ?? DEFAULT_HOST,
    port,
    user: process.env.XPYUN_USER ?? DEFAULT_USER,
    userKey: process.env.XPYUN_USER_KEY ?? DEFAULT_USER_KEY,
  });
  const stop = async () => {
    await service.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
