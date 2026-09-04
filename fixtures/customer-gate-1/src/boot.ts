import { createHash } from "node:crypto";

import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import {
  ensureProtectedRoleBaselineRelease,
  protectedRoleBaselineReconciliationOperation,
  protectedRoleBaselineReconciliationTarget,
  type AuthorizationExpectedRevision
} from "@k-nex/runtime";
import { getPayload, type Payload, type SanitizedConfig } from "payload";

import payloadConfig from "./payload.config.js";
import { assertApplicationMigrationRevision } from "./migration-revision.js";

export interface BootGate1ApplicationOptions {
  readonly config?: Promise<SanitizedConfig>;
  readonly key: string;
}

export async function bootGate1Application(options: BootGate1ApplicationOptions): Promise<Payload> {
  const payload = await getPayload({ config: options.config ?? payloadConfig, key: options.key });
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
    await payload.destroy();
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
