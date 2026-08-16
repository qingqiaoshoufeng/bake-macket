import type {
  AdminSessionView,
  CurrentCloudPrinterView,
  ManualPrintResolutionRequest,
  PrintBatchView,
  PrintJobView,
  ProcessPrintBatchResult,
} from '@bake-mall/contracts';

import {
  AdminPermission,
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  ManualPrintResolution,
  PrintJobStatus,
} from '../../config/contracts.generated.js';
import type { MemorySessionStore } from '../../utils/admin-session.js';
import {
  createSecureUuidV4,
  requireUuidV4,
  type RandomUuidFactory,
} from '../../utils/random-uuid.js';
import type { PrintingOrdersApi } from '../api/printing-orders.js';
import {
  PRINTING_ORDERS_PAGE_SIZE,
  PROCESSABLE_BATCH_STATUSES,
  isPrintableOrder,
} from '../config/printing-orders.js';
import type {
  PrintingOrdersState,
  PrintingPrinterIntent,
  PrintingResultSummary,
} from '../type/printing-orders.js';

export const PRINTING_ORDERS_STORAGE_KEY = 'bake-mall:admin-printing-orders';
const ADMIN_ID_PATTERN = /^[1-9]\d*$/u;

type PrintingOrdersStorage = Readonly<{
  get: (key: string) => unknown;
  remove: (key: string) => void;
  set: (key: string, value: unknown) => void;
}>;

type Dependencies = Readonly<{
  adminSession: MemorySessionStore<AdminSessionView>;
  api: PrintingOrdersApi;
  randomUUID?: RandomUuidFactory;
  now?: () => number;
  storage?: PrintingOrdersStorage;
}>;

export const ONLINE_STATUS_MAX_AGE_MS = 30_000;
const APPEND_BATCH_SIZE = 100;
const PRINTER_PAGE_SIZE = 100;
const MAX_PRINTER_PAGES = 100;
const PERSISTED_BATCH_KEYS = [
  'batchId',
  'pendingOperationKeys',
  'printerId',
  'printerLabel',
] as const;

type PrintingResultCounts = Pick<
  PrintingResultSummary,
  'accepted' | 'failed' | 'unknown' | 'manualReview'
>;

function defaultStorage(): PrintingOrdersStorage {
  return {
    get: (key) => wx.getStorageSync(key),
    remove: (key) => wx.removeStorageSync(key),
    set: (key, value) => wx.setStorageSync(key, value),
  };
}

function decodeBase64Url(value: string): string | null {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const normalized = value
    .replace(/-/gu, '+')
    .replace(/_/gu, '/')
    .replace(/=+$/gu, '');
  const indexes = Array.from(normalized).map((character) =>
    alphabet.indexOf(character),
  );
  if (indexes.some((index) => index < 0)) return null;
  const bits = indexes
    .map((index) => index.toString(2).padStart(6, '0'))
    .join('');
  const bytes = bits.match(/.{8}/gu)?.map((byte) => Number.parseInt(byte, 2)) ?? [];
  return String.fromCharCode(...bytes);
}

function adminIdFromSession(session: AdminSessionView | null): string | null {
  const payload = session?.accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = decodeBase64Url(payload);
    const value: unknown = decoded ? JSON.parse(decoded) : null;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    return record.aud === 'mall-admin' &&
      typeof record.sub === 'string' &&
      ADMIN_ID_PATTERN.test(record.sub)
      ? record.sub
      : null;
  } catch {
    return null;
  }
}

function storageKey(adminId: string): string {
  return `${PRINTING_ORDERS_STORAGE_KEY}:${adminId}`;
}

function hasPermission(
  session: AdminSessionView | null,
  permission: AdminPermission,
): boolean {
  return Boolean(
    session &&
    session.permissions.some((candidate) => candidate === permission),
  );
}

function isUnauthorizedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 401
  );
}

function safeMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    if (isUnauthorizedError(error)) {
      return '管理员会话已失效，请重新进入';
    }
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }
  return fallback;
}

export function printerUnavailableReason(
  printer: PrintingOrdersState['printers'][number],
  now: number,
): string | null {
  if (printer.status !== CloudPrinterStatus.ACTIVE) return '未处于 ACTIVE 状态';
  if (printer.onlineStatus === CloudPrinterOnlineStatus.OFFLINE)
    return '设备离线';
  if (printer.onlineStatus === CloudPrinterOnlineStatus.ABNORMAL)
    return '设备状态异常';
  if (printer.onlineStatus !== CloudPrinterOnlineStatus.ONLINE)
    return '在线状态未知';
  const checkedAt = printer.lastStatusCheckedAt
    ? Date.parse(printer.lastStatusCheckedAt)
    : Number.NaN;
  if (
    !Number.isFinite(checkedAt) ||
    now - checkedAt < 0 ||
    now - checkedAt > ONLINE_STATUS_MAX_AGE_MS
  ) {
    return '在线状态已过期';
  }
  return null;
}

function isAvailablePrinter(
  printer: PrintingOrdersState['printers'][number],
  now: number,
): boolean {
  return printerUnavailableReason(printer, now) === null;
}

function availablePrintersAt(
  printers: PrintingOrdersState['printers'],
  at: number,
): PrintingOrdersState['printers'] {
  return printers.filter((printer) => isAvailablePrinter(printer, at));
}

function printerLabel(
  printer: PrintingOrdersState['printers'][number],
): string {
  return `${printer.displayName}（${printer.serialNumberMasked}）`;
}

function printerExists(
  printers: readonly PrintingOrdersState['printers'][number][],
  printerId: string | null,
): boolean {
  return Boolean(
    printerId && printers.some((printer) => printer.id === printerId),
  );
}

function markCurrentPrinters(
  printers: readonly PrintingOrdersState['printers'][number][],
  current: PrintingOrdersState['current'],
): readonly PrintingOrdersState['printers'][number][] {
  const currentPrinter = current?.printer ?? null;
  const withFlags = printers.map((printer) =>
    printer.id === currentPrinter?.id
      ? { ...currentPrinter, isCurrent: true }
      : { ...printer, isCurrent: false },
  );
  return currentPrinter && !printerExists(withFlags, currentPrinter.id)
    ? [{ ...currentPrinter, isCurrent: true }, ...withFlags]
    : withFlags;
}

function cloneState(state: PrintingOrdersState): PrintingOrdersState {
  return {
    ...state,
    orders: state.orders.map((order) => ({ ...order })),
    printers: state.printers.map((printer) => ({ ...printer })),
    availablePrinters: state.availablePrinters.map((printer) => ({ ...printer })),
    current: state.current
      ? {
          ...state.current,
          printer: state.current.printer ? { ...state.current.printer } : null,
        }
      : null,
    selectedOrderIds: [...state.selectedOrderIds],
    result: state.result
      ? {
          ...state.result,
          batch: { ...state.result.batch },
          jobs: state.result.jobs.map((job) => ({ ...job })),
        }
      : null,
  };
}

function summaryOf(
  result: ProcessPrintBatchResult,
  jobs: readonly PrintJobView[] = [],
): PrintingResultSummary {
  return {
    batch: result.batch,
    jobs,
    processedCount: result.processedCount,
    accepted: result.accepted,
    failed: result.failed,
    unknown: result.unknown,
    manualReview: result.manualReview,
  };
}

function replaceJob(
  jobs: readonly PrintJobView[],
  replacement: PrintJobView,
): readonly PrintJobView[] {
  return jobs.map((job) => (job.id === replacement.id ? replacement : job));
}

function countsOfJobs(jobs: readonly PrintJobView[]): PrintingResultCounts {
  return jobs.reduce(
    (counts, job) => ({
      accepted:
        counts.accepted + (job.status === PrintJobStatus.ACCEPTED ? 1 : 0),
      failed: counts.failed + (job.status === PrintJobStatus.FAILED ? 1 : 0),
      unknown: counts.unknown + (job.status === PrintJobStatus.UNKNOWN ? 1 : 0),
      manualReview:
        counts.manualReview +
        (job.status === PrintJobStatus.MANUAL_REVIEW ? 1 : 0),
    }),
    { accepted: 0, failed: 0, unknown: 0, manualReview: 0 },
  );
}

export function createPrintingOrdersController(dependencies: Dependencies) {
  const randomUUID = dependencies.randomUUID ?? createSecureUuidV4;
  const now = dependencies.now ?? Date.now;
  const storage = dependencies.storage ?? defaultStorage();
  const adminId = adminIdFromSession(dependencies.adminSession.get());
  const persistedStorageKey = adminId ? storageKey(adminId) : null;
  let requestGeneration = 0;
  let state: PrintingOrdersState = {
    orders: [],
    printers: [],
    availablePrinters: [],
    current: null,
    selectedOrderIds: [],
    selectedPrinterId: null,
    selectionSource: null,
    rememberedManualPrinterId: null,
    selectionMessage: '正在加载打印设备…',
    selectionRevision: 0,
    printersLoadedAt: null,
    loadSucceeded: false,
    selectionReady: false,
    page: 1,
    pageSize: PRINTING_ORDERS_PAGE_SIZE,
    total: 0,
    loading: false,
    submitting: false,
    manualContinueRequired: false,
    setupContinueRequired: false,
    pendingBatchId: null,
    pendingBatchPrinterLabel: null,
    pendingOperationKeys: {},
    error: null,
    result: null,
  };

  function persistedBatch(): {
    batchId: string;
    pendingOperationKeys: Readonly<Record<string, string>>;
    printerId: string | null;
    printerLabel: string | null;
  } | null {
    const value = persistedStorageKey ? storage.get(persistedStorageKey) : undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const operationKeys = record.pendingOperationKeys;
    const hasLegacyKeys =
      keys.length === 2 &&
      ['batchId', 'pendingOperationKeys'].every((key) =>
        Object.prototype.hasOwnProperty.call(record, key),
      );
    const hasCurrentKeys =
      keys.length === PERSISTED_BATCH_KEYS.length &&
      PERSISTED_BATCH_KEYS.every((key) =>
        Object.prototype.hasOwnProperty.call(record, key),
      );
    if (
      (!hasLegacyKeys && !hasCurrentKeys) ||
      typeof record.batchId !== 'string' ||
      typeof operationKeys !== 'object' ||
      operationKeys === null ||
      Array.isArray(operationKeys) ||
      (record.batchId.length === 0 && Object.keys(operationKeys).length === 0) ||
      !Object.values(operationKeys).every(
        (value) => typeof value === 'string' && value.length > 0,
      ) ||
      (hasCurrentKeys &&
        !(
          (record.printerId === null || typeof record.printerId === 'string') &&
          (record.printerLabel === null || typeof record.printerLabel === 'string')
        ))
    ) {
      if (persistedStorageKey) storage.remove(persistedStorageKey);
      return null;
    }
    return {
      batchId: record.batchId,
      pendingOperationKeys: operationKeys as Readonly<Record<string, string>>,
      printerId:
        hasCurrentKeys && typeof record.printerId === 'string'
          ? record.printerId
          : null,
      printerLabel:
        hasCurrentKeys && typeof record.printerLabel === 'string'
          ? record.printerLabel
          : null,
    };
  }

  function persistBatchState(): void {
    if (!persistedStorageKey) return;
    if (!state.pendingBatchId && Object.keys(state.pendingOperationKeys).length === 0) {
      storage.remove(persistedStorageKey);
      return;
    }
    storage.set(persistedStorageKey, {
      batchId: state.pendingBatchId ?? '',
      pendingOperationKeys: { ...state.pendingOperationKeys },
      printerId: state.result?.batch.printerId ?? state.selectedPrinterId,
      printerLabel: state.pendingBatchPrinterLabel,
    });
  }

  const restored = persistedBatch();
  if (restored) {
    const resumableIntent = Object.keys(restored.pendingOperationKeys).find(
      (operationId) =>
        operationId.startsWith('single:') || operationId.startsWith('create:'),
    );
    const [kind, firstId, secondId] = resumableIntent?.split(':') ?? [];
    const restoredPrinterId = kind === 'single' ? secondId : firstId;
    const restoredOrderIds = kind === 'single' ? firstId : secondId;
    state = {
      ...state,
      selectedOrderIds: restoredOrderIds ? restoredOrderIds.split(',') : [],
      selectedPrinterId: restoredPrinterId ?? null,
      selectionSource: restoredPrinterId ? 'restored' : null,
      pendingBatchId: restored.batchId || null,
      pendingBatchPrinterLabel: restored.printerLabel,
      pendingOperationKeys: restored.pendingOperationKeys,
      manualContinueRequired: restored.batchId.length > 0,
      selectionMessage:
        restored.batchId && !restored.printerLabel
          ? '恢复的旧批次无法确认固化设备，请不要将当前设备视为该批次设备。'
          : restoredPrinterId
            ? '将使用恢复请求中固化的原打印机。'
            : state.selectionMessage,
      setupContinueRequired: Boolean(resumableIntent),
    };
  }

  function clearSensitiveState(): void {
    state = {
      ...state,
      orders: [],
      printers: [],
      availablePrinters: [],
      current: null,
      selectedOrderIds: [],
      selectedPrinterId: null,
      rememberedManualPrinterId: null,
      selectionSource: null,
      selectionMessage: '管理员会话已失效，请重新进入',
      printersLoadedAt: null,
      loadSucceeded: false,
      selectionReady: false,
      pendingBatchId: null,
      pendingBatchPrinterLabel: null,
      pendingOperationKeys: {},
      result: null,
    };
  }

  function handleOperationError(error: unknown, fallback: string): Error {
    const message = safeMessage(error, fallback);
    if (isUnauthorizedError(error)) {
      dependencies.adminSession.clear();
      clearSensitiveState();
    }
    state = { ...state, error: message };
    return new Error(message);
  }

  function authorized(): boolean {
    const session = dependencies.adminSession.get();
    return (
      hasPermission(session, AdminPermission.ORDER_READ) &&
      hasPermission(session, AdminPermission.PRINT_EXECUTE)
    );
  }

  function snapshot(): PrintingOrdersState {
    return cloneState(state);
  }

  function automaticSelection(
    printers: readonly PrintingOrdersState['printers'][number][],
    availablePrinters: readonly PrintingOrdersState['printers'][number][],
    current: PrintingOrdersState['current'],
    loadedAt: number,
  ): Pick<
    PrintingOrdersState,
    'selectedPrinterId' | 'selectionSource' | 'selectionMessage'
  > {
    if (state.selectionSource === 'restored' && state.selectedPrinterId) {
      const restored = printers.find(
        (printer) => printer.id === state.selectedPrinterId,
      );
      const reason = restored
        ? printerUnavailableReason(restored, loadedAt)
        : '设备已不存在';
      return {
        selectedPrinterId: state.selectedPrinterId,
        selectionSource: 'restored',
        selectionMessage: reason
          ? `恢复请求的原打印机不可用（${reason}），请先恢复设备后再继续；不会自动换机。`
          : '将使用恢复请求中固化的原打印机，服务端当前设备变化不会替换它。',
      };
    }
    if (state.selectionSource === 'manual') {
      const rememberedId = state.selectedPrinterId ?? state.rememberedManualPrinterId;
      const remembered = printers.find((printer) => printer.id === rememberedId);
      if (remembered && isAvailablePrinter(remembered, loadedAt)) {
        return {
          selectedPrinterId: remembered.id,
          selectionSource: 'manual',
          selectionMessage: '已保留本页面手动选择；不会修改服务端当前设备。',
        };
      }
      const rememberedName = remembered?.displayName ?? '原手选设备';
      return {
        selectedPrinterId: null,
        selectionSource: 'manual',
        selectionMessage: `${rememberedName}已失效，请重新选择打印机；不会回退到当前设备。`,
      };
    }
    if (current?.printer) {
      const reason = printerUnavailableReason(current.printer, loadedAt);
      return reason
        ? {
            selectedPrinterId: null,
            selectionSource: null,
            selectionMessage: `当前设备“${current.printer.displayName}”不可用：${reason}。不会自动改选其他设备，可手动选择。`,
          }
        : {
            selectedPrinterId: current.printer.id,
            selectionSource: 'current',
            selectionMessage: '已按服务端当前设备自动选择。',
          };
    }
    if (availablePrinters.length === 1) {
      return {
        selectedPrinterId: availablePrinters[0]!.id,
        selectionSource: 'single-available',
        selectionMessage: '未设置当前设备，已自动选择唯一可用设备。',
      };
    }
    return {
      selectedPrinterId: null,
      selectionSource: null,
      selectionMessage:
        availablePrinters.length === 0
          ? '未设置当前设备，暂无可用打印机。'
          : '未设置当前设备且有多台可用打印机，请明确选择本次使用的设备。',
    };
  }

  async function loadAllPrinters() {
    async function loadPage(
      page: number,
      accumulated: PrintingOrdersState['printers'],
    ): Promise<PrintingOrdersState['printers']> {
      if (page > MAX_PRINTER_PAGES) {
        throw new Error('打印机分页响应异常，请联系管理员');
      }
      const result = await dependencies.api.listPrinters({
        page,
        pageSize: PRINTER_PAGE_SIZE,
      });
      if (
        result.page !== page ||
        result.pageSize !== PRINTER_PAGE_SIZE ||
        result.total < 0 ||
        result.items.length > PRINTER_PAGE_SIZE
      ) {
        throw new Error('打印机分页响应异常，请联系管理员');
      }
      const combined = [...accumulated, ...result.items];
      if (combined.length >= result.total) return combined.slice(0, result.total);
      if (result.items.length === 0 || result.total > MAX_PRINTER_PAGES * PRINTER_PAGE_SIZE) {
        throw new Error('打印机分页响应异常，请联系管理员');
      }
      return loadPage(page + 1, combined);
    }
    return loadPage(1, []);
  }

  async function load(): Promise<void> {
    if (!authorized()) throw new Error('当前账号无权打印订单');
    requestGeneration += 1;
    const requestId = requestGeneration;
    state = {
      ...state,
      loading: true,
      loadSucceeded: false,
      selectionReady: false,
      error: null,
    };
    try {
      const [orders, loadedPrinters, current] = await Promise.all([
        dependencies.api.listOrders({
          page: state.page,
          pageSize: state.pageSize,
        }),
        loadAllPrinters(),
        dependencies.api.getCurrentPrinter(),
      ]);
      if (requestId !== requestGeneration) return;
      const printableOrders = orders.items.filter(isPrintableOrder);
      const loadedAt = now();
      const authoritativeCurrent: CurrentCloudPrinterView = {
        ...current,
        printer: current.printer ? { ...current.printer, isCurrent: true } : null,
      };
      const printers = markCurrentPrinters(
        loadedPrinters,
        authoritativeCurrent,
      );
      const availablePrinters = availablePrintersAt(printers, loadedAt);
      const selection = automaticSelection(
        printers,
        availablePrinters,
        authoritativeCurrent,
        loadedAt,
      );
      state = {
        ...state,
        orders: printableOrders,
        printers,
        availablePrinters,
        current: authoritativeCurrent,
        selectedOrderIds: [...state.selectedOrderIds],
        ...selection,
        rememberedManualPrinterId:
          state.selectionSource === 'manual'
            ? state.selectedPrinterId ?? state.rememberedManualPrinterId
            : state.rememberedManualPrinterId,
        selectionRevision: state.selectionRevision + 1,
        printersLoadedAt: loadedAt,
        loadSucceeded: true,
        selectionReady: true,
        page: orders.page,
        pageSize: orders.pageSize,
        total: orders.total,
      };
    } catch (error) {
      const message = safeMessage(error, '订单打印数据加载失败，请稍后重试');
      if (isUnauthorizedError(error)) {
        dependencies.adminSession.clear();
        clearSensitiveState();
      }
      if (requestId === requestGeneration) {
        state = {
          ...state,
          loadSucceeded: false,
          selectionReady: false,
          error: message,
        };
      }
      throw new Error(message);
    } finally {
      if (requestId === requestGeneration) state = { ...state, loading: false };
    }
  }

  function toggleOrder(orderId: string): void {
    if (!state.orders.some((order) => order.id === orderId)) return;
    const selected = state.selectedOrderIds.some((id) => id === orderId);
    state = {
      ...state,
      selectedOrderIds: selected
        ? state.selectedOrderIds.filter((id) => id !== orderId)
        : [...state.selectedOrderIds, orderId],
      result: null,
    };
  }

  function selectPrinter(printerId: string): void {
    if (state.selectionSource === 'restored') return;
    if (!state.availablePrinters.some((printer) => printer.id === printerId))
      return;
    state = {
      ...state,
      selectedPrinterId: printerId,
      selectionSource: 'manual',
      rememberedManualPrinterId: printerId,
      selectionMessage: '本次打印已手动选机；不会修改服务端当前设备。',
      selectionRevision: state.selectionRevision + 1,
      result: null,
    };
  }

  function requireOperationalLoad(): void {
    if (!state.loadSucceeded || !state.selectionReady || state.loading) {
      throw new Error('打印数据尚未完整加载，请先刷新');
    }
  }

  function currentAvailablePrinters(): PrintingOrdersState['printers'] {
    requireOperationalLoad();
    const loadedAt = state.printersLoadedAt;
    const currentTime = now();
    if (
      loadedAt === null ||
      currentTime - loadedAt < 0 ||
      currentTime - loadedAt > ONLINE_STATUS_MAX_AGE_MS
    ) {
      state = {
        ...state,
        loadSucceeded: false,
        selectionReady: false,
        error: '打印机状态已过期，请刷新后重新确认',
      };
      throw new Error('打印机状态已过期，请刷新后重新确认');
    }
    return availablePrintersAt(state.printers, currentTime);
  }

  function selectedAvailablePrinter(): PrintingOrdersState['printers'][number] {
    if (!state.selectedPrinterId) throw new Error('请选择一台在线打印机');
    const selected = currentAvailablePrinters().find(
      (printer) => printer.id === state.selectedPrinterId,
    );
    if (!selected) {
      const selectedPrinter = state.printers.find(
        (printer) => printer.id === state.selectedPrinterId,
      );
      const reason = selectedPrinter
        ? printerUnavailableReason(selectedPrinter, now())
        : '设备已不存在';
      state = {
        ...state,
        loadSucceeded: false,
        selectionReady: false,
        error: `所选打印机当前不可用：${reason ?? '状态未知'}，请刷新后重新选择`,
      };
      throw new Error(
        state.selectionSource === 'restored'
          ? '恢复请求的原打印机不可用，禁止自动换机'
          : `所选打印机当前不可用：${reason ?? '状态未知'}，请重新选择`,
      );
    }
    return selected;
  }

  function createPrintIntent(): PrintingPrinterIntent {
    const selected = selectedAvailablePrinter();
    return {
      printerId: selected.id,
      printerLabel: printerLabel(selected),
      selectionRevision: state.selectionRevision,
    };
  }

  function requirePrintIntent(
    expected?: PrintingPrinterIntent | string,
  ): PrintingPrinterIntent {
    const intent =
      typeof expected === 'object' && expected !== null
        ? expected
        : createPrintIntent();
    const selected = selectedAvailablePrinter();
    if (
      intent.printerId !== selected.id ||
      intent.selectionRevision !== state.selectionRevision ||
      intent.printerLabel !== printerLabel(selected)
    ) {
      throw new Error('打印机选择或状态已变化，请重新确认');
    }
    return intent;
  }

  async function operationKey(operationId: string): Promise<string> {
    const existing = state.pendingOperationKeys[operationId];
    if (existing) return existing;
    const created = await requireUuidV4(randomUUID);
    state = {
      ...state,
      pendingOperationKeys: {
        ...state.pendingOperationKeys,
        [operationId]: created,
      },
    };
    persistBatchState();
    return created;
  }

  function releaseOperationKey(operationId: string): void {
    state = {
      ...state,
      pendingOperationKeys: Object.fromEntries(
        Object.entries(state.pendingOperationKeys).filter(
          ([candidate]) => candidate !== operationId,
        ),
      ),
    };
    persistBatchState();
  }

  function requiresManualContinue(batch: PrintBatchView): boolean {
    return (
      batch.pendingCount > 0 &&
      PROCESSABLE_BATCH_STATUSES.some((status) => status === batch.status)
    );
  }

  function orderIdChunks(orderIds: readonly string[]): readonly string[][] {
    return Array.from(
      { length: Math.ceil(orderIds.length / APPEND_BATCH_SIZE) },
      (_, index) =>
        orderIds.slice(
          index * APPEND_BATCH_SIZE,
          (index + 1) * APPEND_BATCH_SIZE,
        ),
    );
  }

  async function loadBatchJobs(batchId: string) {
    const jobs = await dependencies.api.listJobs({
      batchId,
      page: 1,
      pageSize: 100,
    });
    return jobs.items;
  }

  async function submit(
    expectedIntent?: PrintingPrinterIntent | string,
  ): Promise<PrintingResultSummary> {
    if (!authorized()) throw new Error('当前账号无权打印订单');
    if (state.submitting) throw new Error('打印请求正在提交，请勿重复操作');
    const intent = requirePrintIntent(expectedIntent);
    const printerId = intent.printerId;
    if (state.selectedOrderIds.length === 0)
      throw new Error('请至少选择一笔订单');
    const orderIds = [...state.selectedOrderIds];
    state = {
      ...state,
      submitting: true,
      pendingBatchPrinterLabel: intent.printerLabel,
      error: null,
      result: null,
    };
    try {
      if (orderIds.length === 1) {
        const operationId = `single:${orderIds[0]}:${printerId}`;
        const single = await dependencies.api.createSingle(
          { orderId: orderIds[0]!, printerId },
          await operationKey(operationId),
        );
        releaseOperationKey(operationId);
        const jobs = [single.job];
        const result: PrintingResultSummary = {
          batch: single.batch,
          jobs,
          processedCount: 1,
          ...countsOfJobs(jobs),
        };
        state = { ...state, result, selectedOrderIds: [] };
        return result;
      }

      const createOperationId = `create:${printerId}:${orderIds.join(',')}`;
      const created = await dependencies.api.createBatch(
        { printerId },
        await operationKey(createOperationId),
      );
      state = { ...state, pendingBatchId: created.batch.id };
      const appendOperations = orderIdChunks(orderIds).map(
        (chunk, index) => ({
          chunk,
          operationId: `append:${created.batch.id}:${index}`,
        }),
      );
      await appendOperations.reduce<Promise<void>>(
        (previous, { chunk, operationId }) =>
          previous.then(async () => {
            await dependencies.api.appendBatch(
              created.batch.id,
              { orderIds: chunk },
              await operationKey(operationId),
            );
          }),
        Promise.resolve(),
      );
      const sealOperationId = `seal:${created.batch.id}`;
      await dependencies.api.sealBatch(
        created.batch.id,
        await operationKey(sealOperationId),
      );
      const processOperationId = `process:${created.batch.id}`;
      const processed = await dependencies.api.processBatch(
        created.batch.id,
        await operationKey(processOperationId),
      );
      const jobs = await loadBatchJobs(created.batch.id);
      const result = summaryOf(processed, jobs);
      const manualContinueRequired = requiresManualContinue(processed.batch);
      state = {
        ...state,
        pendingOperationKeys: {},
      };
      state = {
        ...state,
        result,
        selectedOrderIds: [],
        manualContinueRequired,
        setupContinueRequired: false,
        pendingBatchId: manualContinueRequired ? created.batch.id : null,
        pendingOperationKeys: {},
      };
      persistBatchState();
      return result;
    } catch (error) {
      throw handleOperationError(error, '打印请求失败，请稍后重试');
    } finally {
      state = { ...state, submitting: false };
    }
  }

  async function continueBatch(): Promise<PrintingResultSummary> {
    requireOperationalLoad();
    if (!state.pendingBatchPrinterLabel) {
      throw new Error('该批次的固化打印机无法确认，禁止继续');
    }
    const current = state.result;
    const batchId = current?.batch.id ?? state.pendingBatchId;
    if (!batchId || !state.manualContinueRequired) {
      throw new Error('当前没有可继续的打印批次');
    }
    if (state.submitting) throw new Error('打印请求正在提交，请勿重复操作');
    state = { ...state, submitting: true, error: null };
    try {
      const processOperationId = `process:${batchId}`;
      const processKey = await operationKey(processOperationId);
      state = {
        ...state,
        pendingBatchId: batchId,
        pendingOperationKeys: {
          ...state.pendingOperationKeys,
          [processOperationId]: processKey,
        },
      };
      persistBatchState();
      const processed = await dependencies.api.processBatch(
        batchId,
        processKey,
      );
      const jobs = await loadBatchJobs(batchId);
      releaseOperationKey(processOperationId);
      const result = {
        ...summaryOf(processed, jobs),
        processedCount:
          (current?.processedCount ?? 0) + processed.processedCount,
        accepted: (current?.accepted ?? 0) + processed.accepted,
        failed: (current?.failed ?? 0) + processed.failed,
        unknown: (current?.unknown ?? 0) + processed.unknown,
        manualReview: (current?.manualReview ?? 0) + processed.manualReview,
      };
      const manualContinueRequired = requiresManualContinue(processed.batch);
      state = {
        ...state,
        result,
        manualContinueRequired,
        setupContinueRequired: false,
        pendingBatchId: manualContinueRequired ? batchId : null,
        pendingOperationKeys: {},
      };
      persistBatchState();
      return result;
    } catch (error) {
      throw handleOperationError(error, '批次继续失败，请稍后重试');
    } finally {
      state = { ...state, submitting: false };
    }
  }

  function updateResolvedJob(batch: PrintBatchView, job: PrintJobView): void {
    if (!state.result) return;
    const jobs = replaceJob(state.result.jobs, job);
    state = {
      ...state,
      result: { ...state.result, batch, jobs, ...countsOfJobs(jobs) },
    };
  }

  async function runRecovery(
    operation: () => Promise<void>,
    fallback: string,
  ): Promise<void> {
    state = { ...state, submitting: true, error: null };
    try {
      await operation();
    } catch (error) {
      throw handleOperationError(error, fallback);
    } finally {
      state = { ...state, submitting: false };
    }
  }

  async function queryUnknown(job: PrintJobView): Promise<void> {
    requireOperationalLoad();
    if (job.status !== PrintJobStatus.UNKNOWN) {
      throw new Error('仅状态未知的打印任务可以查询');
    }
    await runRecovery(async () => {
      const operationId = `query:${job.id}`;
      const result = await dependencies.api.queryUnknown(
        job.id,
        await operationKey(operationId),
      );
      releaseOperationKey(operationId);
      updateResolvedJob(result.batch, result.job);
    }, '未知任务查询失败，请稍后重试');
  }

  async function processRecoveryBatch(batchId: string): Promise<void> {
    const operationId = `process:${batchId}`;
    const processed = await dependencies.api.processBatch(
      batchId,
      await operationKey(operationId),
    );
    const jobs = await loadBatchJobs(batchId);
    releaseOperationKey(operationId);
    const manualContinueRequired = requiresManualContinue(processed.batch);
    state = {
      ...state,
      result: summaryOf(processed, jobs),
      manualContinueRequired,
      setupContinueRequired: false,
      pendingBatchId: manualContinueRequired ? batchId : null,
    };
    persistBatchState();
  }

  async function retryFailed(
    job: PrintJobView,
    expectedIntent?: PrintingPrinterIntent,
  ): Promise<void> {
    if (job.status !== PrintJobStatus.FAILED) {
      throw new Error('仅明确失败的打印任务可以重试');
    }
    const printerId = requirePrintIntent(expectedIntent).printerId;
    await runRecovery(async () => {
      const operationId = `retry:${job.id}:${printerId}`;
      const retry = await dependencies.api.retryFailed(
        job.id,
        { printerId },
        await operationKey(operationId),
      );
      state = { ...state, pendingBatchId: retry.batch.id };
      persistBatchState();
      await processRecoveryBatch(retry.batch.id);
      releaseOperationKey(operationId);
    }, '失败任务重试失败，请稍后重试');
  }

  async function resolveManual(
    job: PrintJobView,
    resolution: ManualPrintResolution,
    expectedIntent?: PrintingPrinterIntent,
  ): Promise<void> {
    requireOperationalLoad();
    if (job.status !== PrintJobStatus.MANUAL_REVIEW) {
      throw new Error('仅人工复核任务可以处置');
    }
    const request: ManualPrintResolutionRequest =
      resolution === ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK
        ? {
            resolution,
            printerId: requirePrintIntent(expectedIntent).printerId,
            confirmDuplicateRisk: true,
          }
        : { resolution };
    await runRecovery(async () => {
      const operationId = `manual:${job.id}:${resolution}`;
      const result = await dependencies.api.resolveManual(
        job.id,
        request,
        await operationKey(operationId),
      );
      releaseOperationKey(operationId);
      if (
        result.resolution === ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK
      ) {
        await processRecoveryBatch(result.retryBatch.id);
      } else {
        updateResolvedJob(result.batch, result.job);
      }
    }, '人工处置失败，请稍后重试');
  }

  async function setPage(page: number): Promise<void> {
    state = { ...state, page, result: null };
    await load();
  }

  return {
    authorized,
    continueBatch,
    createPrintIntent,
    load,
    queryUnknown,
    resolveManual,
    retryFailed,
    selectPrinter,
    setPage,
    snapshot,
    submit,
    toggleOrder,
  } as const;
}
