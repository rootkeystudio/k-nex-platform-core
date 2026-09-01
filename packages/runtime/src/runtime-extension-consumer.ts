import type { ExtensionIdentity } from "@k-nex/contracts";

import type { RuntimeExtensionStore } from "./plugin-manager.js";
import { ExtensionRevisionTracker } from "./extension-revision-tracker.js";

export interface RuntimeExtensionInvalidation {
  readonly applicationId: string;
  readonly environment: string;
  readonly extension: ExtensionIdentity;
  readonly inventoryRevision: number;
}

export interface RuntimeExtensionRevisionPollingOptions {
  /** Periodic recovery is intentionally modest; invalidations remain the fast path. */
  readonly intervalMs?: number;
  /** Polling failures do not stop later recovery attempts. */
  readonly onError?: (error: unknown) => void;
  /** Injectable only to make lifecycle cleanup deterministic in tests. */
  readonly schedule?: (work: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

const defaultPollingIntervalMs = 30_000;

/** A process-local cache whose source of truth remains the runtime store. */
export class RuntimeExtensionRevisionConsumer {
  private readonly tracker = new ExtensionRevisionTracker();
  private readonly intervalMs: number;
  private readonly schedule: (work: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private polling: Promise<boolean> | undefined;
  private timer: unknown;
  private running = false;
  private lifecycle = 0;

  constructor(
    private readonly store: Pick<RuntimeExtensionStore, "observeActiveGeneration">,
    private readonly applicationId: string,
    private readonly environment: string,
    private readonly extension: ExtensionIdentity,
    private readonly options: RuntimeExtensionRevisionPollingOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? defaultPollingIntervalMs;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 50 || this.intervalMs > 300_000) throw new TypeError("Runtime extension revision polling interval is invalid.");
    this.schedule = options.schedule ?? ((work, delayMs) => setTimeout(work, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  invalidate(invalidation: RuntimeExtensionInvalidation): boolean {
    if (invalidation.applicationId !== this.applicationId || invalidation.environment !== this.environment ||
      invalidation.extension.deliveryClass !== this.extension.deliveryClass || invalidation.extension.id !== this.extension.id) {
      return false;
    }
    return this.tracker.invalidate(invalidation.inventoryRevision);
  }

  async poll(): Promise<boolean> {
    if (this.polling) return this.polling;
    const polling = this.observe();
    this.polling = polling;
    try { return await polling; }
    finally {
      if (this.polling === polling) this.polling = undefined;
    }
  }

  /** Starts one owned recovery loop. Calls are idempotent and never overlap polls. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const lifecycle = ++this.lifecycle;
    void this.pollAndSchedule(lifecycle);
  }

  /** Stops future polls; an in-flight store read may finish but cannot reschedule itself. */
  stop(): void {
    this.running = false;
    ++this.lifecycle;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }

  get started(): boolean { return this.running; }

  snapshot() {
    return this.tracker.snapshot();
  }

  private async observe(): Promise<boolean> {
    return this.tracker.observe(await this.store.observeActiveGeneration(this.applicationId, this.environment, this.extension));
  }

  private async pollAndSchedule(lifecycle: number): Promise<void> {
    try { await this.poll(); }
    catch (error) { this.options.onError?.(error); }
    finally {
      if (!this.running || this.lifecycle !== lifecycle) return;
      this.timer = this.schedule(() => {
        this.timer = undefined;
        void this.pollAndSchedule(lifecycle);
      }, this.intervalMs);
    }
  }
}
