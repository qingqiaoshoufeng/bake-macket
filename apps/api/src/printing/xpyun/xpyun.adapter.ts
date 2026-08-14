import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type AppConfig } from '../../config/env.schema.js';
import type {
  XpyunAddPrinterResult,
  XpyunDeletePrinterResult,
  XpyunOnlineResult,
  XpyunOrderResult,
  XpyunPrinterInput,
  XpyunPrintResult,
  XpyunReceiptInput,
  XpyunAdapterErrorClassification,
} from './xpyun.types.js';

export const XPYUN_FETCHER = Symbol('XPYUN_FETCHER');
export const XPYUN_NOW = Symbol('XPYUN_NOW');
export const XPYUN_LOGGER = Symbol('XPYUN_LOGGER');

type SafeLogger = Readonly<{
  warn: (summary: Readonly<Record<string, unknown>>) => void;
}>;
type VendorEnvelope = Readonly<{
  code: string;
  data: unknown;
  message: string;
}>;
type Operation =
  'addPrinter' | 'deletePrinter' | 'print' | 'queryOnline' | 'queryOrder';

const ONLINE_STATUSES = {
  0: 'OFFLINE',
  1: 'ONLINE',
  2: 'ABNORMAL',
} as const;
const ORDER_IDEMPOTENT_VENDOR_CODE = '1013';
const MAX_VENDOR_ORDER_ID_LENGTH = 128;
const SILENT_PRINT_VOICE = 1;

export class XpyunAdapterError extends Error {
  constructor(
    readonly classification: XpyunAdapterErrorClassification,
    readonly vendorCode: string | null = null,
  ) {
    super(
      classification === 'FAILED'
        ? 'Xpyun rejected the request.'
        : classification === 'RATE_LIMITED'
          ? 'Xpyun rate limited the request.'
          : classification === 'UNAVAILABLE'
            ? 'Xpyun is temporarily unavailable.'
            : classification === 'VALIDATION_FAILED'
              ? 'Xpyun request validation failed.'
              : 'Xpyun request result is unknown.',
    );
    this.name = 'XpyunAdapterError';
  }
}

function safeRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function vendorCode(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isInteger(value)
      ? String(value)
      : null;
  }
  return typeof value === 'string' &&
    value.trim() === value &&
    /^(?:0|-?[1-9]\d*)$/u.test(value)
    ? value
    : null;
}

function httpFailureClassification(
  status: number,
): 'RATE_LIMITED' | 'UNAVAILABLE' | null {
  if (status === 429) return 'RATE_LIMITED';
  return status >= 500 && status <= 599 ? 'UNAVAILABLE' : null;
}

function parseEnvelope(value: unknown): VendorEnvelope {
  const record = safeRecord(value);
  const code = vendorCode(record?.code);
  const message = nonEmptyString(record?.msg);
  if (!record || code === null || message === null || !('data' in record)) {
    throw new XpyunAdapterError('UNKNOWN');
  }
  if (code !== '0') throw new XpyunAdapterError('FAILED', code);
  return { code, data: record.data, message };
}

function maskSerialNumber(serialNumber: string): string {
  if (serialNumber.length <= 4) return '*'.repeat(serialNumber.length);
  return `${serialNumber.slice(0, 2)}${'*'.repeat(Math.max(2, serialNumber.length - 4))}${serialNumber.slice(-2)}`;
}

function parseVendorOrderId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1) return null;
  if (value.length > MAX_VENDOR_ORDER_ID_LENGTH || /\s/u.test(value)) {
    return null;
  }
  return /[\p{Cc}\p{Cf}]/u.test(value) ? null : value;
}

function parseAcceptedJob(envelope: VendorEnvelope): XpyunPrintResult {
  const vendorJobId = parseVendorOrderId(envelope.data);
  if (!vendorJobId) throw new XpyunAdapterError('UNKNOWN');
  return {
    classification: 'ACCEPTED',
    vendorCode: envelope.code,
    vendorJobId,
  };
}

function parseOrderState(envelope: VendorEnvelope): XpyunOrderResult {
  if (typeof envelope.data !== 'boolean') {
    throw new XpyunAdapterError('UNKNOWN');
  }
  return { printed: envelope.data, vendorCode: envelope.code };
}

function parsePrinterListResult(
  envelope: VendorEnvelope,
  serialNumber: string,
): Readonly<{ succeeded: true } | { succeeded: false; vendorCode: string }> {
  const data = safeRecord(envelope.data);
  const success = data?.success;
  const failed = data?.fail;
  const failureMessages = data?.failMsg;
  if (
    !Array.isArray(success) ||
    !Array.isArray(failed) ||
    !Array.isArray(failureMessages) ||
    !success.every((value) => typeof value === 'string') ||
    !failed.every((value) => typeof value === 'string') ||
    !failureMessages.every((value) => typeof value === 'string') ||
    failed.length !== failureMessages.length
  ) {
    throw new XpyunAdapterError('UNKNOWN');
  }

  if (success.length + failed.length !== 1) {
    throw new XpyunAdapterError('UNKNOWN');
  }
  if (success[0] === serialNumber) return { succeeded: true };
  if (failed[0] !== serialNumber) throw new XpyunAdapterError('UNKNOWN');

  const failureMessage = failureMessages[0] ?? '';
  const failurePrefix = `${serialNumber}:`;
  if (!failureMessage.startsWith(failurePrefix)) {
    throw new XpyunAdapterError('UNKNOWN');
  }
  const parsedCode = vendorCode(failureMessage.slice(failurePrefix.length));
  if (parsedCode === null || parsedCode === '0') {
    throw new XpyunAdapterError('UNKNOWN');
  }
  return { succeeded: false, vendorCode: parsedCode };
}

@Injectable()
export class XpyunAdapter {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    @Optional()
    @Inject(XPYUN_FETCHER)
    private readonly fetcher: typeof fetch = fetch,
    @Optional()
    @Inject(XPYUN_NOW)
    private readonly now: () => number = Date.now,
    @Optional()
    @Inject(XPYUN_LOGGER)
    private readonly logger: SafeLogger = new Logger(XpyunAdapter.name),
  ) {}

  async addPrinter(input: XpyunPrinterInput): Promise<XpyunAddPrinterResult> {
    const envelope = await this.request(
      'addPrinter',
      '/api/openapi/xprinter/addPrinters',
      {
        items: [{ sn: input.serialNumber, name: input.displayName }],
        debug: '0',
      },
      input.serialNumber,
    );
    const result = parsePrinterListResult(envelope, input.serialNumber);
    if (!result.succeeded) {
      throw new XpyunAdapterError('FAILED', result.vendorCode);
    }
    return { vendorCode: envelope.code, vendorMessage: envelope.message };
  }

  async deletePrinter(serialNumber: string): Promise<XpyunDeletePrinterResult> {
    const envelope = await this.request(
      'deletePrinter',
      '/api/openapi/xprinter/delPrinters',
      { snlist: [serialNumber] },
      serialNumber,
    );
    const result = parsePrinterListResult(envelope, serialNumber);
    if (!result.succeeded) {
      throw new XpyunAdapterError('FAILED', result.vendorCode);
    }
    return { vendorCode: envelope.code, vendorMessage: envelope.message };
  }

  async queryOnline(serialNumber: string): Promise<XpyunOnlineResult> {
    const envelope = await this.request(
      'queryOnline',
      '/api/openapi/xprinter/queryPrinterStatus',
      { sn: serialNumber },
      serialNumber,
    );
    const status =
      typeof envelope.data === 'number'
        ? ONLINE_STATUSES[envelope.data as keyof typeof ONLINE_STATUSES]
        : undefined;
    if (!status) throw new XpyunAdapterError('UNKNOWN');
    return { status, vendorCode: envelope.code };
  }

  async print(input: XpyunReceiptInput): Promise<XpyunPrintResult> {
    if (input.tradeOrderId.length < 1 || input.tradeOrderId.length > 50) {
      throw new XpyunAdapterError('VALIDATION_FAILED');
    }
    const envelope = await this.request(
      'print',
      '/api/openapi/xprinter/print',
      {
        sn: input.serialNumber,
        content: input.content,
        copies: 1,
        voice: SILENT_PRINT_VOICE,
        mode: 0,
        idempotent: input.tradeOrderId,
      },
      input.serialNumber,
    );
    return parseAcceptedJob(envelope);
  }

  async queryOrder(vendorJobId: string): Promise<XpyunOrderResult> {
    const orderId = parseVendorOrderId(vendorJobId);
    if (!orderId) throw new XpyunAdapterError('VALIDATION_FAILED');
    const envelope = await this.request(
      'queryOrder',
      '/api/openapi/xprinter/queryOrderState',
      { orderId },
    );
    return parseOrderState(envelope);
  }

  private environment() {
    return this.config.get('appEnv', { infer: true });
  }

  private authentication(): Readonly<{
    sign: string;
    timestamp: string;
    user: string;
  }> {
    const { XPYUN_USER, XPYUN_USER_KEY } = this.environment();
    const timestamp = Math.floor(this.now() / 1_000).toString();
    const sign = createHash('sha1')
      .update(`${XPYUN_USER}${XPYUN_USER_KEY}${timestamp}`, 'utf8')
      .digest('hex');
    return { user: XPYUN_USER, timestamp, sign };
  }

  private async request(
    operation: Operation,
    path: string,
    body: Readonly<Record<string, unknown>>,
    serialNumber?: string,
  ): Promise<VendorEnvelope> {
    const startedAt = this.now();
    const { XPYUN_BASE_URL, XPYUN_TIMEOUT_MS } = this.environment();
    try {
      const response = await this.fetcher(new URL(path, XPYUN_BASE_URL), {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({ ...body, ...this.authentication() }),
        redirect: 'error',
        signal: AbortSignal.timeout(XPYUN_TIMEOUT_MS),
      });
      const statusClassification = httpFailureClassification(response.status);
      if (statusClassification) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new XpyunAdapterError(statusClassification);
        }
        const payloadRecord = safeRecord(payload);
        const payloadCode = vendorCode(payloadRecord?.code);
        throw new XpyunAdapterError(
          statusClassification,
          payloadCode === null || payloadCode === '0' ? null : payloadCode,
        );
      }

      const payload: unknown = await response.json();
      try {
        const payloadRecord = safeRecord(payload);
        const payloadCode = vendorCode(payloadRecord?.code);
        if (
          operation === 'print' &&
          payloadCode === ORDER_IDEMPOTENT_VENDOR_CODE
        ) {
          throw new XpyunAdapterError('UNKNOWN', payloadCode);
        }
        const envelope = parseEnvelope(payload);
        if (!response.ok) throw new XpyunAdapterError('UNKNOWN');
        return envelope;
      } catch (error) {
        if (error instanceof XpyunAdapterError) throw error;
        throw new XpyunAdapterError('UNKNOWN');
      }
    } catch (error) {
      const safeError =
        error instanceof XpyunAdapterError
          ? error
          : new XpyunAdapterError('UNKNOWN');
      this.logger.warn({
        operation,
        elapsedMs: Math.max(0, this.now() - startedAt),
        vendorCode: safeError.vendorCode,
        ...(serialNumber
          ? { serialNumberMasked: maskSerialNumber(serialNumber) }
          : {}),
      });
      throw safeError;
    }
  }
}
