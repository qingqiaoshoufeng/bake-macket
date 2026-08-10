import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { CloudPrinterReconciliationService } from './cloud-printer-reconciliation.service.js';

export const CLOUD_PRINTER_RECONCILIATION_SCHEDULER_OPTIONS = Symbol(
  'CLOUD_PRINTER_RECONCILIATION_SCHEDULER_OPTIONS',
);

const DEFAULT_INTERVAL_MS = 60_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export type CloudPrinterReconciliationSchedulerOptions = Readonly<{
  intervalMs: number;
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}>;

const DEFAULT_OPTIONS: CloudPrinterReconciliationSchedulerOptions = {
  intervalMs: DEFAULT_INTERVAL_MS,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

@Injectable()
export class CloudPrinterReconciliationScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: TimerHandle | undefined;
  private activeCycle: Promise<void> | undefined;
  private started = false;
  private shuttingDown = false;

  constructor(
    private readonly reconciliation: CloudPrinterReconciliationService,
    @Optional()
    @Inject(CLOUD_PRINTER_RECONCILIATION_SCHEDULER_OPTIONS)
    private readonly options: CloudPrinterReconciliationSchedulerOptions = DEFAULT_OPTIONS,
  ) {}

  onApplicationBootstrap(): void {
    if (this.started || this.shuttingDown) return;
    this.started = true;
    this.scheduleNext();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    this.started = false;
    if (this.timer !== undefined) {
      this.options.clearTimeout(this.timer);
      this.timer = undefined;
    }

    const activeCycle = this.activeCycle;
    if (activeCycle !== undefined) {
      await activeCycle.catch(() => undefined);
    }
  }

  private scheduleNext(): void {
    if (
      !this.started ||
      this.shuttingDown ||
      this.timer !== undefined ||
      this.activeCycle !== undefined
    ) {
      return;
    }
    this.timer = this.options.setTimeout(() => {
      this.timer = undefined;
      void this.runCycle();
    }, this.options.intervalMs);
  }

  private async runCycle(): Promise<void> {
    if (!this.started || this.shuttingDown || this.activeCycle) return;

    const cycle = Promise.resolve()
      .then(() => this.reconciliation.reconcileStaleBatch())
      .then(() => undefined)
      .catch(() => undefined);
    this.activeCycle = cycle;
    await cycle;
    if (this.activeCycle === cycle) this.activeCycle = undefined;
    this.scheduleNext();
  }
}
