export const sourceFreshnessIntervalsMs = Object.freeze({
  live: 15_000,
  standard: 60_000,
  background: 300_000
});

export type SourceFreshnessClass = keyof typeof sourceFreshnessIntervalsMs;
export type SourceConvergenceReason = "initial" | "invalidation" | "reconnect" | "focus" | "periodic";

export interface AuthoritativeSourceSnapshot<T> {
  readonly data: T;
  readonly revision: number;
}

export interface SourceConvergenceState<T> {
  readonly data: T | null;
  readonly lastValidatedAt: number | null;
  readonly revision: number | null;
  readonly status: "error" | "forbidden" | "idle" | "ready" | "stale";
}

export interface SourceConvergenceDependencies<T> {
  authorize(signal: AbortSignal): boolean | Promise<boolean>;
  fetch(reason: SourceConvergenceReason, signal: AbortSignal): Promise<AuthoritativeSourceSnapshot<T>>;
  readonly freshness: SourceFreshnessClass;
  readonly refreshTimeoutMs?: number;
  readonly surface: "workspace" | "other";
  now?(): number;
  readonly signals?: SourceConvergenceSignals;
}

export interface SourceConvergenceSignals {
  onInvalidation(listener: (revision: number) => void): () => void;
  onReconnect(listener: () => void): () => void;
  onWindowFocus(listener: () => void): () => void;
}

function revision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Source revision must be a nonnegative safe integer.");
  return value;
}

export class SourceConvergenceController<T> {
  private readonly clock: () => number;
  private readonly refreshTimeoutMs: number;
  private stateValue: SourceConvergenceState<T> = Object.freeze({ data: null, lastValidatedAt: null, revision: null, status: "idle" });
  private refreshPromise: Promise<SourceConvergenceState<T>> | undefined;
  private minimumRevision = 0;
  private periodicTimer: ReturnType<typeof setInterval> | undefined;
  private signalCleanup: readonly (() => void)[] = [];

  constructor(private readonly dependencies: SourceConvergenceDependencies<T>) {
    this.clock = dependencies.now ?? Date.now;
    if (!(dependencies.freshness in sourceFreshnessIntervalsMs)) throw new TypeError("Unknown source freshness class.");
    this.refreshTimeoutMs = dependencies.refreshTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.refreshTimeoutMs) || this.refreshTimeoutMs < 1 || this.refreshTimeoutMs > 60_000) {
      throw new RangeError("refreshTimeoutMs must be an integer between 1 and 60000.");
    }
  }

  get state(): SourceConvergenceState<T> {
    return this.stateValue;
  }

  initialize(): Promise<SourceConvergenceState<T>> {
    return this.refresh("initial");
  }

  async start(): Promise<SourceConvergenceState<T>> {
    if (this.periodicTimer) return this.stateValue;
    const interval = sourceFreshnessIntervalsMs[this.dependencies.freshness];
    this.periodicTimer = setInterval(() => { void this.handlePeriodicTick(); }, interval);
    (this.periodicTimer as unknown as { unref?(): void }).unref?.();
    const signals = this.dependencies.signals;
    this.signalCleanup = signals ? Object.freeze([
      signals.onInvalidation((nextRevision) => { void this.handleInvalidation(nextRevision); }),
      signals.onReconnect(() => { void this.handleReconnect(); }),
      signals.onWindowFocus(() => { void this.handleWindowFocus(); })
    ]) : [];
    return this.initialize();
  }

  stop(): void {
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.periodicTimer = undefined;
    for (const cleanup of this.signalCleanup) cleanup();
    this.signalCleanup = [];
  }

  async handleInvalidation(nextRevision: number): Promise<SourceConvergenceState<T>> {
    const parsed = revision(nextRevision);
    if (this.stateValue.revision !== null && parsed <= this.stateValue.revision) return this.stateValue;
    this.minimumRevision = Math.max(this.minimumRevision, parsed);
    this.stateValue = Object.freeze({ ...this.stateValue, status: "stale" });
    return this.refresh("invalidation");
  }

  handleReconnect(): Promise<SourceConvergenceState<T>> {
    this.stateValue = Object.freeze({ ...this.stateValue, status: "stale" });
    return this.refresh("reconnect");
  }

  handleWindowFocus(): Promise<SourceConvergenceState<T>> {
    if (this.dependencies.surface !== "workspace" || this.age() < sourceFreshnessIntervalsMs.live) return Promise.resolve(this.stateValue);
    return this.refresh("focus");
  }

  handlePeriodicTick(): Promise<SourceConvergenceState<T>> {
    if (this.age() < sourceFreshnessIntervalsMs[this.dependencies.freshness]) return Promise.resolve(this.stateValue);
    return this.refresh("periodic");
  }

  private age(): number {
    return this.stateValue.lastValidatedAt === null ? Number.POSITIVE_INFINITY : Math.max(0, this.clock() - this.stateValue.lastValidatedAt);
  }

  private refresh(reason: SourceConvergenceReason): Promise<SourceConvergenceState<T>> {
    if (this.refreshPromise) return this.refreshPromise;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<SourceConvergenceState<T>>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        this.minimumRevision = 0;
        this.stateValue = Object.freeze({ data: null, lastValidatedAt: this.clock(), revision: null, status: "error" });
        resolve(this.stateValue);
      }, this.refreshTimeoutMs);
      (timer as unknown as { unref?(): void }).unref?.();
    });
    const refresh = Promise.race([this.runRefresh(reason, controller.signal), timeout]).finally(() => clearTimeout(timer));
    this.refreshPromise = refresh.finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async runRefresh(reason: SourceConvergenceReason, signal: AbortSignal): Promise<SourceConvergenceState<T>> {
    let authorized: boolean;
    try {
      authorized = await this.dependencies.authorize(signal);
    } catch {
      if (signal.aborted) return this.stateValue;
      this.stateValue = Object.freeze({ data: null, lastValidatedAt: this.clock(), revision: null, status: "error" });
      return this.stateValue;
    }
    if (signal.aborted) return this.stateValue;
    if (!authorized) {
      this.minimumRevision = 0;
      this.stateValue = Object.freeze({ data: null, lastValidatedAt: this.clock(), revision: null, status: "forbidden" });
      return this.stateValue;
    }
    try {
      const snapshot = await this.dependencies.fetch(reason, signal);
      if (signal.aborted) return this.stateValue;
      const snapshotRevision = revision(snapshot.revision);
      if (this.stateValue.revision !== null && snapshotRevision < this.stateValue.revision) {
        this.stateValue = Object.freeze({ ...this.stateValue, status: "error" });
        return this.stateValue;
      }
      const status = snapshotRevision < this.minimumRevision ? "stale" : "ready";
      if (status === "ready") this.minimumRevision = 0;
      this.stateValue = Object.freeze({
        data: snapshot.data,
        lastValidatedAt: this.clock(),
        revision: snapshotRevision,
        status
      });
      return this.stateValue;
    } catch {
      this.stateValue = Object.freeze({ ...this.stateValue, status: "error" });
      return this.stateValue;
    }
  }
}
