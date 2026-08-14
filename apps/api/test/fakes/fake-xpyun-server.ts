import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';

export type FakeXpyunRequest = Readonly<{
  body: Readonly<Record<string, unknown>>;
  headers: Readonly<Record<string, string>>;
  method: string;
  path: string;
}>;

type QueuedResponse =
  | Readonly<{ kind: 'disconnect' }>
  | Readonly<{ kind: 'json'; body: unknown; status: number }>
  | Readonly<{
      kind: 'redirect';
      location: string;
      status: 307 | 308;
    }>
  | Readonly<{ kind: 'text'; body: string; status: number }>
  | Readonly<{ kind: 'timeout' }>;

type VendorConfiguration = Readonly<{
  user: string;
  userKey: string;
}>;

type VendorMethod =
  | 'addPrinter'
  | 'deletePrinter'
  | 'printLabel'
  | 'queryOrder'
  | 'queryPrinterStatus';

function headersRecord(
  headers: IncomingHttpHeaders,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(',') : (value ?? ''),
    ]),
  );
}

async function readBody(request: AsyncIterable<Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function requestBody(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function safeRequestBody(
  body: Readonly<Record<string, unknown>>,
  userKey?: string,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(body).filter(
      ([key, value]) =>
        key.toLowerCase() !== 'userkey' &&
        (typeof value !== 'string' || value !== userKey),
    ),
  );
}

function jsonResponse(
  response: ServerResponse,
  body: unknown,
  status = 200,
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json;charset=UTF-8');
  response.end(JSON.stringify(body));
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;
}

function vendorMethod(path: string): VendorMethod | null {
  switch (path) {
    case '/api/openapi/xprinter/addPrinters':
      return 'addPrinter';
    case '/api/openapi/xprinter/delPrinters':
      return 'deletePrinter';
    case '/api/openapi/xprinter/queryPrinterStatus':
      return 'queryPrinterStatus';
    case '/api/openapi/xprinter/print':
      return 'printLabel';
    case '/api/openapi/xprinter/queryOrderState':
      return 'queryOrder';
    default:
      return null;
  }
}

function hasString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasValidOrderId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !/\s/u.test(value) &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function hasValidMethodBody(
  method: VendorMethod,
  body: Readonly<Record<string, unknown>>,
): boolean {
  switch (method) {
    case 'addPrinter':
      return (
        body.debug === '0' &&
        Array.isArray(body.items) &&
        body.items.length > 0 &&
        body.items.every((item) => {
          const record = requestBody(item);
          return hasString(record?.sn) && hasString(record.name);
        })
      );
    case 'deletePrinter': {
      const serialNumbers = stringArray(body.snlist);
      return serialNumbers !== null && serialNumbers.length > 0;
    }
    case 'queryPrinterStatus':
      return hasString(body.sn);
    case 'printLabel':
      return (
        hasString(body.sn) &&
        hasString(body.content) &&
        body.copies === 1 &&
        body.voice === 1 &&
        body.mode === 0 &&
        hasString(body.idempotent)
      );
    case 'queryOrder':
      return hasValidOrderId(body.orderId);
  }
}

export class FakeXpyunServer {
  readonly baseUrl: string;
  private readonly recordedRequests: FakeXpyunRequest[] = [];
  private readonly queuedResponses: QueuedResponse[] = [];
  private readonly printers = new Map<string, number>();
  private readonly jobs = new Map<string, boolean>();
  private readonly idempotentJobs = new Map<string, string>();
  private vendorConfiguration?: VendorConfiguration;
  private nextJobNumber = 1;
  private ownershipPrintFailureCode: string | null = null;

  private constructor(
    private readonly server: Server,
    port: number,
  ) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  static async start(): Promise<FakeXpyunServer> {
    let instance: FakeXpyunServer | null = null;
    const server = createServer(async (request, response) => {
      try {
        const parsedBody = await readBody(request);
        const body = requestBody(parsedBody);
        if (!body) {
          response.statusCode = 400;
          response.end('bad request');
          return;
        }
        const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        const method = vendorMethod(path);
        if (
          instance?.vendorConfiguration &&
          !instance.hasValidAuthentication(body)
        ) {
          instance.recordRequest(request.headers, request.method, path, body);
          jsonResponse(response, {
            code: -3,
            msg: 'REQUEST_SIGN_FAILED',
            data: null,
          });
          return;
        }
        if (!method || !hasValidMethodBody(method, body)) {
          instance?.recordRequest(request.headers, request.method, path, body);
          jsonResponse(
            response,
            { code: -2, msg: 'REQUEST_PARAM_INVALID', data: null },
            method ? 200 : 404,
          );
          return;
        }
        instance?.recordRequest(request.headers, request.method, path, body);
        const queued = instance?.queuedResponses.shift();
        if (queued) {
          if (queued.kind === 'timeout') return;
          if (queued.kind === 'disconnect') {
            request.socket.destroy();
            return;
          }
          if (queued.kind === 'redirect') {
            response.statusCode = queued.status;
            response.setHeader('location', queued.location);
            response.end();
            return;
          }
          response.statusCode = queued.status;
          response.setHeader(
            'content-type',
            queued.kind === 'json'
              ? 'application/json;charset=UTF-8'
              : 'text/plain;charset=UTF-8',
          );
          response.end(
            queued.kind === 'json' ? JSON.stringify(queued.body) : queued.body,
          );
          return;
        }
        instance?.handleVendorRequest(path, body, response);
      } catch {
        response.statusCode = 400;
        response.end('bad request');
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Fake Xpyun server did not bind a TCP port.');
    }
    instance = new FakeXpyunServer(server, address.port);
    return instance;
  }

  configureVendor(configuration: VendorConfiguration): void {
    this.vendorConfiguration = { ...configuration };
  }

  seedPrinter(serialNumber: string, onlineStatus = 1): void {
    this.printers.set(serialNumber, onlineStatus);
  }

  setPrinterOnlineStatus(serialNumber: string, onlineStatus: 0 | 1 | 2): void {
    this.printers.set(serialNumber, onlineStatus);
  }

  failNextOwnershipPrint(vendorCode = '1004'): void {
    this.ownershipPrintFailureCode = vendorCode;
  }

  enqueueJson(body: unknown, status = 200): void {
    this.queuedResponses.push({ kind: 'json', body, status });
  }

  enqueueText(body: string, status = 200): void {
    this.queuedResponses.push({ kind: 'text', body, status });
  }

  enqueueRedirect(location: string, status: 307 | 308): void {
    this.queuedResponses.push({ kind: 'redirect', location, status });
  }

  enqueueTimeout(): void {
    this.queuedResponses.push({ kind: 'timeout' });
  }

  enqueueDisconnect(): void {
    this.queuedResponses.push({ kind: 'disconnect' });
  }

  lastRequest(): FakeXpyunRequest {
    const request = this.recordedRequests.at(-1);
    if (!request) throw new Error('No Xpyun request was recorded.');
    return request;
  }

  requests(): readonly FakeXpyunRequest[] {
    return this.recordedRequests.map((request) => ({
      ...request,
      body: { ...request.body },
      headers: { ...request.headers },
    }));
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private recordRequest(
    headers: IncomingHttpHeaders,
    method: string | undefined,
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): void {
    this.recordedRequests.push({
      body: safeRequestBody(body, this.vendorConfiguration?.userKey),
      headers: headersRecord(headers),
      method: method ?? 'GET',
      path,
    });
  }

  private hasValidAuthentication(
    body: Readonly<Record<string, unknown>>,
  ): boolean {
    if (!this.vendorConfiguration || 'UserKEY' in body) return false;
    const { user, userKey } = this.vendorConfiguration;
    const timestamp = body.timestamp;
    if (
      body.user !== user ||
      typeof timestamp !== 'string' ||
      !/^\d{10}$/u.test(timestamp)
    ) {
      return false;
    }
    const expectedSign = createHash('sha1')
      .update(`${user}${userKey}${timestamp}`, 'utf8')
      .digest('hex');
    return body.sign === expectedSign;
  }

  private handleVendorRequest(
    path: string,
    body: Readonly<Record<string, unknown>>,
    response: ServerResponse,
  ): void {
    switch (path) {
      case '/api/openapi/xprinter/addPrinters':
        this.addPrinters(body, response);
        return;
      case '/api/openapi/xprinter/delPrinters':
        this.deletePrinters(body, response);
        return;
      case '/api/openapi/xprinter/queryPrinterStatus':
        this.queryPrinterStatus(body, response);
        return;
      case '/api/openapi/xprinter/print':
        this.print(body, response);
        return;
      case '/api/openapi/xprinter/queryOrderState':
        this.queryOrderState(body, response);
        return;
      default:
        jsonResponse(
          response,
          { code: -2, msg: 'REQUEST_PARAM_INVALID', data: null },
          404,
        );
    }
  }

  private addPrinters(
    body: Readonly<Record<string, unknown>>,
    response: ServerResponse,
  ): void {
    const items = Array.isArray(body.items) ? body.items : [];
    const outcomes = items.reduce<{
      success: string[];
      fail: string[];
      failMsg: string[];
    }>(
      (result, item) => {
        const record =
          item !== null && typeof item === 'object'
            ? (item as Readonly<Record<string, unknown>>)
            : null;
        const serialNumber = typeof record?.sn === 'string' ? record.sn : '';
        const valid = /^[A-Za-z0-9-]{1,64}$/u.test(serialNumber);
        const code = !valid
          ? '1010'
          : this.printers.has(serialNumber)
            ? '1011'
            : null;
        if (code) {
          return {
            ...result,
            fail: [...result.fail, serialNumber],
            failMsg: [...result.failMsg, `${serialNumber}:${code}`],
          };
        }
        this.printers.set(serialNumber, 1);
        return { ...result, success: [...result.success, serialNumber] };
      },
      { success: [], fail: [], failMsg: [] },
    );
    jsonResponse(response, { code: 0, msg: 'ok', data: outcomes });
  }

  private deletePrinters(
    body: Readonly<Record<string, unknown>>,
    response: ServerResponse,
  ): void {
    const serialNumbers = stringArray(body.snlist) ?? [];
    const outcomes = serialNumbers.reduce<{
      success: string[];
      fail: string[];
      failMsg: string[];
    }>(
      (result, serialNumber) => {
        if (!this.printers.delete(serialNumber)) {
          return {
            ...result,
            fail: [...result.fail, serialNumber],
            failMsg: [...result.failMsg, `${serialNumber}:1002`],
          };
        }
        return { ...result, success: [...result.success, serialNumber] };
      },
      { success: [], fail: [], failMsg: [] },
    );
    jsonResponse(response, { code: 0, msg: 'ok', data: outcomes });
  }

  private queryPrinterStatus(
    body: Readonly<Record<string, unknown>>,
    response: ServerResponse,
  ): void {
    const serialNumber = typeof body.sn === 'string' ? body.sn : '';
    const status = this.printers.get(serialNumber);
    jsonResponse(
      response,
      status === undefined
        ? { code: 1002, msg: 'PRINTER_NOT_REGISTER', data: null }
        : { code: 0, msg: 'ok', data: status },
    );
  }

  private print(
    body: Readonly<Record<string, unknown>>,
    response: ServerResponse,
  ): void {
    const serialNumber = typeof body.sn === 'string' ? body.sn : '';
    if (!this.printers.has(serialNumber)) {
      jsonResponse(response, {
        code: 1002,
        msg: 'PRINTER_NOT_REGISTER',
        data: null,
      });
      return;
    }
    if (
      this.ownershipPrintFailureCode &&
      typeof body.content === 'string' &&
      body.content.includes('ownership-code:')
    ) {
      const code = this.ownershipPrintFailureCode;
      this.ownershipPrintFailureCode = null;
      jsonResponse(response, {
        code: Number(code),
        msg: 'ADD_ORDER_FAILED',
        data: null,
      });
      return;
    }
    const idempotent =
      typeof body.idempotent === 'string' ? body.idempotent : '';
    const existingJobId = idempotent
      ? this.idempotentJobs.get(idempotent)
      : undefined;
    if (existingJobId) {
      jsonResponse(response, {
        code: 1013,
        msg: 'ORDER_IDEMPOTENT',
        data: null,
      });
      return;
    }
    const jobId = `FAKE-ORDER-${this.nextJobNumber++}`;
    this.jobs.set(jobId, true);
    if (idempotent) this.idempotentJobs.set(idempotent, jobId);
    jsonResponse(response, { code: 0, msg: 'ok', data: jobId });
  }

  private queryOrderState(
    body: Readonly<Record<string, unknown>>,
    response: ServerResponse,
  ): void {
    const orderId = typeof body.orderId === 'string' ? body.orderId : '';
    const printed = this.jobs.get(orderId);
    jsonResponse(
      response,
      printed === undefined
        ? { code: 1005, msg: 'ORDER_NOT_FOUND', data: null }
        : { code: 0, msg: 'ok', data: printed },
    );
  }
}
