import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudPrinterReconciliationScheduler } from './cloud-printer-reconciliation.scheduler.js';
import type { CloudPrinterReconciliationService } from './cloud-printer-reconciliation.service.js';

const INTERVAL_MS = 1_000;

type Deferred = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}>;

const deferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const buildScheduler = (
  reconcileStaleBatch: () => Promise<unknown>,
): CloudPrinterReconciliationScheduler =>
  new CloudPrinterReconciliationScheduler(
    { reconcileStaleBatch } as CloudPrinterReconciliationService,
    {
      intervalMs: INTERVAL_MS,
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle),
    },
  );

describe('CloudPrinterReconciliationScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('schedules one delayed first cycle when bootstrap is entered repeatedly', () => {
    const reconcileStaleBatch = vi.fn(async () => undefined);
    const scheduler = buildScheduler(reconcileStaleBatch);

    scheduler.onApplicationBootstrap();
    scheduler.onApplicationBootstrap();

    expect(reconcileStaleBatch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('runs one batch on a tick and schedules the next tick only after completion', async () => {
    const reconcileStaleBatch = vi.fn(async () => undefined);
    const scheduler = buildScheduler(reconcileStaleBatch);
    scheduler.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(reconcileStaleBatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(reconcileStaleBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcileStaleBatch).toHaveBeenCalledTimes(2);
  });

  it('does not overlap a slow batch with another cycle', async () => {
    const batch = deferred();
    const reconcileStaleBatch = vi.fn(() => batch.promise);
    const scheduler = buildScheduler(reconcileStaleBatch);
    scheduler.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

    expect(reconcileStaleBatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    batch.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('continues scheduling after a rejected batch', async () => {
    const reconcileStaleBatch = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValue(undefined);
    const scheduler = buildScheduler(reconcileStaleBatch);
    scheduler.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(reconcileStaleBatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(reconcileStaleBatch).toHaveBeenCalledTimes(2);
  });

  it('clears a pending timer on shutdown', async () => {
    const reconcileStaleBatch = vi.fn(async () => undefined);
    const scheduler = buildScheduler(reconcileStaleBatch);
    scheduler.onApplicationBootstrap();

    await scheduler.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(vi.getTimerCount()).toBe(0);
    expect(reconcileStaleBatch).not.toHaveBeenCalled();
  });

  it('waits for an active batch before shutdown resolves and does not schedule another cycle', async () => {
    const batch = deferred();
    const reconcileStaleBatch = vi.fn(() => batch.promise);
    const scheduler = buildScheduler(reconcileStaleBatch);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    let shutdownResolved = false;
    const shutdown = scheduler.onApplicationShutdown().then(() => {
      shutdownResolved = true;
    });
    await Promise.resolve();

    expect(shutdownResolved).toBe(false);

    batch.resolve();
    await shutdown;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(reconcileStaleBatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves shutdown when the active batch rejects', async () => {
    const batch = deferred();
    const reconcileStaleBatch = vi.fn(() => batch.promise);
    const scheduler = buildScheduler(reconcileStaleBatch);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    const shutdown = scheduler.onApplicationShutdown();
    batch.reject(new Error('batch failed'));

    await expect(shutdown).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(reconcileStaleBatch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
