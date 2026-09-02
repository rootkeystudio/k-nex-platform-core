import { RuntimeSettingsRevisionConsumer, type SettingsRevisionStateSource } from "@k-nex/runtime";
import {
  PostgresSettingsOutboxDispatcher,
  SettingsOutboxWorker,
  type RuntimeExtensionPool
} from "@k-nex/payload-adapter";

export interface CustomerSettingsBoundaries {
  web(settingsRevision: number): void | Promise<void>;
  worker(settingsRevision: number): void | Promise<void>;
  runner(settingsRevision: number): void | Promise<void>;
}

/** Customer composition: outbox is the fast path; state polling repairs lost delivery. */
export class CustomerSettingsConvergence {
  private readonly consumer: RuntimeSettingsRevisionConsumer;
  private readonly worker: SettingsOutboxWorker;

  constructor(
    pool: RuntimeExtensionPool,
    applicationId: string,
    environment: string,
    boundaries: CustomerSettingsBoundaries,
    options: Readonly<{ dispatchIntervalMs?: number; pollIntervalMs?: number; onError(error: unknown): void }>
  ) {
    const names = ["web", "worker", "runner"] as const;
    if (names.some((name) => typeof boundaries[name] !== "function") || typeof options.onError !== "function") {
      throw new TypeError("Settings convergence composition is invalid.");
    }
    const source: SettingsRevisionStateSource = {
      readState: async (targetApplicationId, targetEnvironment) => {
        const result = await pool.query<{ application_id: string; environment: string; settings_revision: number | string }>(
          "select application_id, environment, settings_revision from k_nex_system_settings_state where application_id=$1 and environment=$2",
          [targetApplicationId, targetEnvironment]
        );
        const row = result.rows[0];
        return row === undefined ? undefined : Object.freeze({
          schemaVersion: 1,
          applicationId: row.application_id,
          environment: row.environment,
          settingsRevision: Number(row.settings_revision)
        });
      }
    };
    this.consumer = new RuntimeSettingsRevisionConsumer(source, applicationId, environment, {
      intervalMs: options.pollIntervalMs ?? 30_000,
      onError: options.onError,
      onAdvance: async (state) => { await Promise.all(names.map((name) => boundaries[name](state.settingsRevision))); }
    });
    this.worker = new SettingsOutboxWorker(new PostgresSettingsOutboxDispatcher(pool, { applicationId, environment }), {
      publish: async (invalidation) => {
        if (this.consumer.invalidate(invalidation)) await this.consumer.poll();
      }
    }, { intervalMs: options.dispatchIntervalMs ?? 1_000, onError: options.onError });
  }

  start(): void {
    this.consumer.start();
    this.worker.start();
  }

  stop(): void {
    this.worker.stop();
    this.consumer.stop();
  }

  dispatchOnce(): Promise<number> { return this.worker.drain(); }

  pollOnce(): Promise<boolean> { return this.consumer.poll(); }
}
