export interface AuthorizationRevisionInvalidation {
  readonly applicationId: string;
  readonly environment: string;
  readonly scope: "application" | "environment";
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
}

export interface AuthorizationRevisionState {
  readonly applicationId: string;
  readonly environment: string;
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
}

export interface AuthorizationRevisionStateSource {
  readState(applicationId: string, environment: string): Promise<AuthorizationRevisionState | undefined>;
}

export interface AuthorizationRevisionPollingOptions {
  /** Periodic recovery is intentionally modest; invalidations remain the fast path. */
  readonly intervalMs?: number;
  /** Applies an authoritative advance before it becomes visible to this consumer. */
  readonly onAdvance?: (state: AuthorizationRevisionState) => void | Promise<void>;
  /** Polling failures do not stop later recovery attempts. */
  readonly onError?: (error: unknown) => void;
  /** Injectable only to make lifecycle cleanup deterministic in tests. */
  readonly schedule?: (work: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

const defaultPollingIntervalMs = 30_000;

/** A process-local revision hint; the authorization store remains authoritative. */
export class RuntimeAuthorizationRevisionConsumer {
  private readonly intervalMs: number;
  private readonly schedule: (work: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private current: AuthorizationRevisionState | undefined;
  private minimum: AuthorizationRevisionState | undefined;
  private polling: Promise<boolean> | undefined;
  private timer: unknown;
  private running = false;
  private lifecycle = 0;

  constructor(
    private readonly source: AuthorizationRevisionStateSource,
    private readonly applicationId: string,
    private readonly environment: string,
    private readonly options: AuthorizationRevisionPollingOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? defaultPollingIntervalMs;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 50 || this.intervalMs > 300_000) throw new TypeError("Authorization revision polling interval is invalid.");
    this.schedule = options.schedule ?? ((work, delayMs) => setTimeout(work, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Records an invalidation floor without treating outbox data as authorization state. */
  invalidate(invalidation: AuthorizationRevisionInvalidation): boolean {
    if (!this.ownsInvalidation(invalidation) || !isRevision(invalidation)) return false;
    const minimum = this.minimum ?? this.current;
    const next = Object.freeze({
      applicationId: this.applicationId,
      environment: this.environment,
      authorizationRevision: Math.max(minimum?.authorizationRevision ?? 0, invalidation.authorizationRevision),
      lifecycleRevision: Math.max(minimum?.lifecycleRevision ?? 0, invalidation.lifecycleRevision)
    });
    if (sameRevision(minimum, next)) return false;
    this.minimum = next;
    return true;
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

  /** Stops future polls; an in-flight source read may finish but cannot reschedule itself. */
  stop(): void {
    this.running = false;
    ++this.lifecycle;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }

  get started(): boolean { return this.running; }

  snapshot(): AuthorizationRevisionState | undefined { return this.current; }

  private async observe(): Promise<boolean> {
    const state = await this.source.readState(this.applicationId, this.environment);
    if (state === undefined || !this.ownsState(state)) return false;
    if (!isRevision(state) || !isAtLeast(state, this.current) || !isAtLeast(state, this.minimum)) return false;
    const next = Object.freeze({ ...state });
    const changed = !sameRevision(this.current, next);
    if (changed) await this.options.onAdvance?.(next);
    this.current = next;
    if (this.minimum !== undefined && isAtLeast(next, this.minimum)) this.minimum = undefined;
    return changed;
  }

  private ownsState(value: Pick<AuthorizationRevisionState, "applicationId" | "environment">): boolean {
    return value.applicationId === this.applicationId && value.environment === this.environment;
  }

  private ownsInvalidation(value: AuthorizationRevisionInvalidation): boolean {
    return value.applicationId === this.applicationId &&
      (value.scope === "application" || value.scope === "environment" && value.environment === this.environment);
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

function isRevision(value: Pick<AuthorizationRevisionInvalidation, "authorizationRevision" | "lifecycleRevision">): boolean {
  return Number.isSafeInteger(value.authorizationRevision) && value.authorizationRevision >= 0
    && Number.isSafeInteger(value.lifecycleRevision) && value.lifecycleRevision >= 0;
}

function isAtLeast(
  value: Pick<AuthorizationRevisionInvalidation, "authorizationRevision" | "lifecycleRevision">,
  minimum: Pick<AuthorizationRevisionInvalidation, "authorizationRevision" | "lifecycleRevision"> | undefined
): boolean {
  return minimum === undefined || (value.authorizationRevision >= minimum.authorizationRevision && value.lifecycleRevision >= minimum.lifecycleRevision);
}

function sameRevision(
  left: Pick<AuthorizationRevisionInvalidation, "authorizationRevision" | "lifecycleRevision"> | undefined,
  right: Pick<AuthorizationRevisionInvalidation, "authorizationRevision" | "lifecycleRevision">
): boolean {
  return left !== undefined && left.authorizationRevision === right.authorizationRevision && left.lifecycleRevision === right.lifecycleRevision;
}
