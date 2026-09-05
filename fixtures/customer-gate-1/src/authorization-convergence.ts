import {
  RuntimeAuthorizationRevisionConsumer,
  type AuthorizationRevisionInvalidation,
  type AuthorizationRevisionState
} from "@k-nex/runtime";
import {
  AuthorizationOutboxWorker,
  PostgresAuthorizationOutboxDispatcher,
  type RuntimeExtensionPool
} from "@k-nex/payload-adapter";

export interface CustomerAuthorizationBoundaries {
  web(state: AuthorizationRevisionState): void | Promise<void>;
  worker(state: AuthorizationRevisionState): void | Promise<void>;
  runner(state: AuthorizationRevisionState): void | Promise<void>;
  gateway(state: AuthorizationRevisionState): void | Promise<void>;
  browser(state: AuthorizationRevisionState): void | Promise<void>;
  remoteUi(state: AuthorizationRevisionState): void | Promise<void>;
  realtime(state: AuthorizationRevisionState): void | Promise<void>;
}

export interface CustomerAuthorizationEnvironment {
  readonly environment: string;
  readonly boundaries: CustomerAuthorizationBoundaries;
}

/** Customer-owned process composition: durable outbox fast path plus authoritative polling recovery. */
export class CustomerAuthorizationConvergence {
  private readonly consumers: readonly RuntimeAuthorizationRevisionConsumer[];
  private readonly workers: readonly AuthorizationOutboxWorker[];

  constructor(
    pool: RuntimeExtensionPool,
    applicationId: string,
    environments: readonly CustomerAuthorizationEnvironment[],
    options: Readonly<{ dispatchIntervalMs?: number; pollIntervalMs?: number; onError(error: unknown): void }>
  ) {
    if (!/^[a-z][a-z0-9-]{2,127}$/u.test(applicationId) || environments.length === 0 ||
      environments.some(({ environment }) => !/^[a-z][a-z0-9-]{1,63}$/u.test(environment)) ||
      new Set(environments.map(({ environment }) => environment)).size !== environments.length || typeof options.onError !== "function") {
      throw new TypeError("Authorization convergence composition is invalid.");
    }
    const pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.consumers = Object.freeze(environments.map(({ environment, boundaries }) => {
      const boundaryNames = ["web", "worker", "runner", "gateway", "browser", "remoteUi", "realtime"] as const;
      if (boundaryNames.some((name) => typeof boundaries[name] !== "function")) throw new TypeError("Authorization convergence boundary is invalid.");
      return new RuntimeAuthorizationRevisionConsumer(
        { readState: async (targetApplicationId, targetEnvironment) => {
          const result = await pool.query<{ application_id: string; authorization_revision: number; lifecycle_revision: number }>(
            `select application_id, authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1`,
            [targetApplicationId]
          );
          const row = result.rows[0];
          return row === undefined ? undefined : Object.freeze({
            applicationId: row.application_id,
            environment: targetEnvironment,
            authorizationRevision: Number(row.authorization_revision),
            lifecycleRevision: Number(row.lifecycle_revision)
          });
        } },
        applicationId,
        environment,
        {
          intervalMs: pollIntervalMs,
          onError: options.onError,
          onAdvance: async (state) => {
            await Promise.all(boundaryNames.map((name) => boundaries[name](state)));
          }
        }
      );
    }));
    const sink = {
      publish: async (invalidation: AuthorizationRevisionInvalidation) => {
        const pending = this.consumers.filter((consumer) => consumer.invalidate(invalidation));
        await Promise.all(pending.map((consumer) => consumer.poll()));
      }
    };
    this.workers = Object.freeze(environments.map(({ environment }) => new AuthorizationOutboxWorker(
      new PostgresAuthorizationOutboxDispatcher(pool, { applicationId, environment }),
      sink,
      { intervalMs: options.dispatchIntervalMs ?? 1_000, onError: options.onError }
    )));
  }

  start(): void {
    for (const consumer of this.consumers) consumer.start();
    for (const worker of this.workers) worker.start();
  }

  stop(): void {
    for (const worker of this.workers) worker.stop();
    for (const consumer of this.consumers) consumer.stop();
  }

  async dispatchOnce(): Promise<number> {
    const delivered = await Promise.all(this.workers.map((worker) => worker.drain()));
    return delivered.reduce((total, count) => total + count, 0);
  }

  async pollOnce(): Promise<number> {
    const changed = await Promise.all(this.consumers.map((consumer) => consumer.poll()));
    return changed.filter(Boolean).length;
  }
}
