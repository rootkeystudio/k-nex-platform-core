import type { SettingsInvalidation, SettingsState } from "@k-nex/contracts";

export interface SettingsRevisionStateSource {
  readState(applicationId: string, environment: string): Promise<SettingsState | undefined>;
}

export interface SettingsRevisionPollingOptions {
  readonly intervalMs?: number;
  readonly onAdvance?: (state: SettingsState) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
  readonly schedule?: (work: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

const defaultPollingIntervalMs = 30_000;

/** Process-local revision hint. PostgreSQL remains authoritative. */
export class RuntimeSettingsRevisionConsumer {
  private readonly intervalMs: number;
  private readonly schedule: (work: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private current: SettingsState | undefined;
  private minimumRevision = 0;
  private polling: Promise<boolean> | undefined;
  private timer: unknown;
  private running = false;
  private lifecycle = 0;

  constructor(
    private readonly source: SettingsRevisionStateSource,
    private readonly applicationId: string,
    private readonly environment: string,
    private readonly options: SettingsRevisionPollingOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? defaultPollingIntervalMs;
    if (!validIdentity(applicationId, environment) || !Number.isSafeInteger(this.intervalMs) || this.intervalMs < 50 || this.intervalMs > 300_000) {
      throw new TypeError("Settings revision consumer configuration is invalid.");
    }
    this.schedule = options.schedule ?? ((work, delayMs) => setTimeout(work, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Records a floor only; outbox data never becomes effective settings state. */
  invalidate(value: SettingsInvalidation): boolean {
    if (value.identity.applicationId !== this.applicationId || value.identity.environment !== this.environment ||
      !Number.isSafeInteger(value.settingsRevision) || value.settingsRevision < 1) return false;
    const next = Math.max(this.minimumRevision, this.current?.settingsRevision ?? 0, value.settingsRevision);
    if (next === this.minimumRevision || next === this.current?.settingsRevision) return false;
    this.minimumRevision = next;
    return true;
  }

  async poll(): Promise<boolean> {
    if (this.polling) return this.polling;
    const polling = this.observe();
    this.polling = polling;
    try { return await polling; }
    finally { if (this.polling === polling) this.polling = undefined; }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const lifecycle = ++this.lifecycle;
    void this.pollAndSchedule(lifecycle);
  }

  stop(): void {
    this.running = false;
    ++this.lifecycle;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }

  get started(): boolean { return this.running; }

  snapshot(): SettingsState | undefined { return this.current; }

  private async observe(): Promise<boolean> {
    const state = await this.source.readState(this.applicationId, this.environment);
    if (!state || state.schemaVersion !== 1 || state.applicationId !== this.applicationId || state.environment !== this.environment ||
      !Number.isSafeInteger(state.settingsRevision) || state.settingsRevision < 0 ||
      state.settingsRevision < (this.current?.settingsRevision ?? 0) || state.settingsRevision < this.minimumRevision) return false;
    const next = Object.freeze({ ...state });
    const changed = next.settingsRevision !== this.current?.settingsRevision;
    if (changed) await this.options.onAdvance?.(next);
    this.current = next;
    if (next.settingsRevision >= this.minimumRevision) this.minimumRevision = 0;
    return changed;
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

function validIdentity(applicationId: string, environment: string): boolean {
  return /^[a-z][a-z0-9-]{2,127}$/u.test(applicationId) && /^[a-z][a-z0-9-]{1,63}$/u.test(environment);
}
