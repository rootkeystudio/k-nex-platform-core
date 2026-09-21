import { createHash } from "node:crypto";

import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import {
  ensureProtectedRoleBaselineRelease,
  protectedRoleBaselineReconciliationOperation,
  protectedRoleBaselineReconciliationTarget,
  type AuthorizationExpectedRevision
} from "@k-nex/runtime";
import { getPayload, type Payload, type SanitizedConfig } from "payload";

import payloadConfig, { composedApplication } from "./payload.config.js";
import { assertApplicationMigrationRevision } from "./migration-revision.js";
import type { FixtureCurrentAuthority } from "./current-authority.js";

export interface BootGate1ApplicationOptions {
  readonly authority?: FixtureCurrentAuthority;
  readonly config?: Promise<SanitizedConfig>;
  readonly key: string;
}

const authorities = new WeakMap<Payload, FixtureCurrentAuthority>();
const shutdowns = new WeakMap<Payload, Promise<void>>();

/** Peeks existing authority only; drain closes admission before Payload closes its pool. */
export async function shutdownGate1Application(payload: Payload): Promise<void> {
  const existing = shutdowns.get(payload);
  if (existing !== undefined) return existing;
  const authority = authorities.get(payload);
  const pool = payload.db.pool as unknown as { end?: () => Promise<void> };
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const shutdown = new Promise<void>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  shutdowns.set(payload, shutdown);
  void (async () => {
    if (typeof pool.end !== "function") { reject(new TypeError("Gate 1 Payload Postgres pool cannot close.")); return; }
    try { if (authority !== undefined) await authority.adapter.drain(); }
    catch (error) { reject(error); return; }
    let destroyError: unknown;
    try { await payload.destroy(); } catch (error) { destroyError = error; }
    let endError: unknown;
    try { await pool.end(); } catch (error) { endError = error; }
    if (destroyError !== undefined && endError !== undefined) { reject(new AggregateError([destroyError, endError], "Gate 1 shutdown failed.")); return; }
    if (destroyError !== undefined) { reject(destroyError); return; }
    if (endError !== undefined) { reject(endError); return; }
    resolve();
  })();
  return shutdown;
}

export async function bootGate1Application(options: BootGate1ApplicationOptions): Promise<Payload> {
  const authority = options.authority ?? (options.config === undefined ? composedApplication.authority : undefined);
  if (authority === undefined) throw new Error("A supplied Gate 1 Payload config requires its paired current authority.");
  const payload = await getPayload({ config: options.config ?? payloadConfig, key: options.key });
  authorities.set(payload, authority);
  try {
    await assertApplicationMigrationRevision(payload);
    const store = new PostgresAuthorizationStore(payload.db.pool);
    await ensureProtectedRoleBaselineRelease({
      store,
      applicationId: "customer-gate-1",
      environment: "production",
      audit: releaseAudit
    });
    return payload;
  } catch (error) {
    await shutdownGate1Application(payload);
    throw error;
  }
}

function releaseAudit(state: AuthorizationExpectedRevision) {
  const suffix = createHash("sha256")
    .update(`${state.applicationId}:${state.authorizationRevision}:protected-baseline-v4`)
    .digest("hex").slice(0, 24);
  return {
    schemaVersion: 1 as const,
    auditId: `release-baseline-audit-${suffix}`,
    decisionId: `release-baseline-decision-${suffix}`,
    correlationId: `release-baseline-correlation-${suffix}`,
    applicationId: state.applicationId,
    environment: state.environment,
    permissionId: "system.roles.manage",
    owner: { kind: "platform" as const, namespace: "system" as const },
    principal: { kind: "service" as const, id: "service:platform-release" },
    effectiveActor: { kind: "service" as const, id: "service:platform-release" },
    scope: { kind: "application" as const, resource: "system.roles" },
    operation: protectedRoleBaselineReconciliationOperation,
    target: protectedRoleBaselineReconciliationTarget,
    authorizationRevision: state.authorizationRevision,
    lifecycleRevision: state.lifecycleRevision,
    outcome: "allow" as const,
    reason: "granted" as const,
    approval: "not-required" as const,
    reauthentication: "not-required" as const
  };
}
