import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import { PostgresRuntimeExtensionStore, type RuntimeExtensionPool, type RuntimeExtensionSession } from "../src/runtime-extension-store.js";
import type { AuthorizationLifecycleProjectionInput } from "../src/authorization-lifecycle-projector.js";

const now = new Date("2026-08-31T12:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const owner = { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application" as const, extensionId: "app.sales-live" };
const authority = { ...owner, generationId: "generation-retained", sourceCommit: "a".repeat(40), artifactDigest: digest("a"), manifestDigest: digest("b"), catalogDigest: digest("c"), provenanceDigest: digest("d"), sbomDigest: digest("e") };
const activeAuthority = { ...authority, generationId: "generation-active" };
const runnerQuarantineMigration = readFileSync(new URL("../../../fixtures/customer-gate-1/src/migrations/20260829_000018_runner_quarantine.ts", import.meta.url), "utf8");

describe("runner quarantine durable reasons", () => {
  it("rejects host-only policy availability before database interaction and excludes it from the migration constraint", async () => {
    const query = vi.fn();
    const pool: RuntimeExtensionPool = { connect: vi.fn(), query };
    const store = new PostgresRuntimeExtensionStore(pool, { now: () => now }, digest("9"));

    await expect(store.quarantineRunnerGeneration({
      applicationId: "customer-alpha",
      environment: "production",
      appId: "app.sales-live",
      generationId: "generation-live",
      expectedRevision: 1,
      reason: "POLICY_UNAVAILABLE" as never
    })).rejects.toMatchObject({ code: "STATE_INVALID" });

    expect(pool.connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(runnerQuarantineMigration).toContain("POLICY_VIOLATION");
    expect(runnerQuarantineMigration).not.toContain("POLICY_UNAVAILABLE");
  });
});

function stage(overrides: Record<string, unknown> = {}) {
  return {
    authority,
    version: "1.0.0",
    readiness: { generationId: authority.generationId, serverGenerationId: authority.generationId, uiGenerationId: authority.generationId, storageGenerationId: authority.generationId, leaseToken: "readiness-token-1", readyAt: "2026-08-31T11:59:00.000Z", expiresAt: "2026-08-31T12:01:00.000Z" },
    compatibility: { status: "compatible" as const, windowId: "window-current", closesAt: "2020-01-01T00:00:00.000Z", migrationDigest: digest("f"), dataRevision: 7 },
    metadata: { locale: "tr" }, settings: { enabled: true }, storageSchemaVersions: { sales: 3 },
    ...overrides
  };
}

function rollbackHarness(overrides: Readonly<{
  planTarget?: string;
  targetAuthority?: typeof authority;
  retained?: Record<string, unknown> | null;
  activeGenerationId?: string;
  rollbackGenerationId?: string | null;
  targetReceiptId?: string | null;
  rollbackCompatibility?: Record<string, unknown>;
  onAdvisoryLock?: () => void;
  projector?: { project(input: AuthorizationLifecycleProjectionInput): Promise<unknown> };
  withoutProjector?: boolean;
}> = {}) {
  const queries: string[] = [];
  let currentNow = now;
  const retained = overrides.retained === undefined
    ? { authority: "verified-bundle", ...authority, version: "1.0.0", receiptId: "receipt-retained" }
    : overrides.retained;
  const activeGenerationId = overrides.activeGenerationId ?? "generation-active";
  const operation = {
    operation_id: "operation-rollback-1", application_id: owner.applicationId, environment: owner.environment, delivery_class: owner.deliveryClass, extension_id: owner.extensionId, operation_kind: "rollback", request_digest: digest("1"),
    request_json: { applicationId: owner.applicationId, environment: owner.environment, extension: { deliveryClass: owner.deliveryClass, id: owner.extensionId }, operation: "rollback", targetVersion: "1.0.0", expectedRevision: 4, idempotencyKey: "rollback-1", correlationId: "correlation-1" },
    authorization_json: { actor: { kind: "trusted-automation", identity: "test" }, decisionId: digest("2") }, expected_revision: 4,
    phase: "planning", lease_owner: "worker-1", lease_token: "lease-1", lease_expires_at: "2026-08-31T12:01:00.000Z",
    plan_json: { executionClass: "live-generation", operationId: "operation-rollback-1", sourceCommit: authority.sourceCommit, generationId: overrides.planTarget ?? authority.generationId,
      plan: { operationId: "operation-rollback-1", operation: "rollback", deliveryClass: owner.deliveryClass, id: owner.extensionId, expectedRevision: 4, currentGenerationId: activeGenerationId, targetGenerationId: overrides.planTarget ?? authority.generationId, version: "1.0.0", artifactDigest: authority.artifactDigest } },
    authority_json: null, result_json: null
  };
  const state = {
    application_id: owner.applicationId, environment: owner.environment, delivery_class: owner.deliveryClass, extension_id: owner.extensionId,
    revision: 5, disposition: "active", active_generation_id: activeGenerationId, rollback_generation_id: overrides.rollbackGenerationId === undefined ? authority.generationId : overrides.rollbackGenerationId,
    active_generation: { authority: "verified-bundle", generationId: activeGenerationId }, rollback_generation: retained,
    rollback_compatibility_json: overrides.rollbackCompatibility ?? { status: "compatible" as const, windowId: "window-current", closesAt: "2026-08-31T12:10:00.000Z", migrationDigest: digest("f"), dataRevision: 7 },
    retained_generation: null, last_operation_id: null, last_receipt_id: null, state_digest: null, inventory_revision: 5
  };
  const targetAuthority = overrides.targetAuthority ?? authority;
  const target = {
    generation_id: authority.generationId, version: "1.0.0", authority_json: targetAuthority,
    authority_digest: `sha256:${createHash("sha256").update(canonicalJson(targetAuthority)).digest("hex")}`, state: "rollback",
    server_generation_id: authority.generationId, ui_generation_id: authority.generationId, storage_generation_id: authority.generationId,
    activation_json: { metadata: { locale: "tr" }, settings: { enabled: true }, storageSchemaVersions: { sales: 3 } }, compatibility_json: stage().compatibility,
    readiness_token: "old-readiness", readiness_expires_at: "2020-01-01T00:00:00.000Z", staged_revision: 4, receipt_id: overrides.targetReceiptId === undefined ? "receipt-retained" : overrides.targetReceiptId, activated_at: null
  };
  const query = vi.fn(async <T extends object>(text: string) => {
    queries.push(text);
    if (text.includes("pg_advisory_xact_lock")) overrides.onAdvisoryLock?.();
    if (text.includes("from runtime_extension_operations")) return { rows: [operation] as unknown as T[] };
    if (text.includes("from runtime_extensions")) return { rows: [state] as unknown as T[] };
    if (text.includes("from runtime_extension_generations")) return { rows: [target] as unknown as T[] };
    if (text.startsWith("update runtime_extension_generations set readiness")) return { rows: [{ generation_id: authority.generationId }] as unknown as T[], rowCount: 1 };
    if (text.startsWith("update runtime_extension_inventory_revisions")) return { rows: [{ revision: 6 }] as unknown as T[], rowCount: 1 };
    if (text.startsWith("update runtime_extensions set revision=") || text.startsWith("update runtime_extension_operations set phase='completed'")) return { rows: [] as T[], rowCount: 1 };
    return { rows: [] as T[], rowCount: 0 };
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  const projector = overrides.projector ?? { project: vi.fn(async () => undefined) };
  const pool: RuntimeExtensionPool = { connect: vi.fn(async () => session), query };
  return {
    store: new PostgresRuntimeExtensionStore(pool, { now: () => currentNow }, digest("9"), overrides.withoutProjector ? {} : { authorizationLifecycleProjector: projector }),
    queries,
    projector,
    expireReadiness: () => { currentNow = new Date("2026-08-31T12:02:00.000Z"); }
  };
}

function expectNoDurableMutation(queries: readonly string[]): void {
  expect(queries.some((query) => /^\s*(?:insert|update|delete)\b/iu.test(query))).toBe(false);
}

function hotApplicationDispositionHarness() {
  const queries: string[] = [];
  const projector = { project: vi.fn(async () => undefined) };
  const activeGeneration = { authority: "verified-bundle", ...activeAuthority, version: "1.0.0", receiptId: "receipt-active" };
  const operation = {
    operation_id: "operation-disable-1", application_id: owner.applicationId, environment: owner.environment, delivery_class: owner.deliveryClass, extension_id: owner.extensionId, operation_kind: "disable",
    request_digest: digest("1"), request_json: { applicationId: owner.applicationId, environment: owner.environment, extension: { deliveryClass: owner.deliveryClass, id: owner.extensionId }, operation: "disable", targetVersion: "1.0.0", expectedRevision: 4, idempotencyKey: "disable-1", correlationId: "correlation-1" },
    authorization_json: { actor: { kind: "trusted-automation", identity: "test" }, decisionId: digest("2") }, expected_revision: 4,
    phase: "planning", lease_owner: "worker-1", lease_token: "lease-1", lease_expires_at: "2026-08-31T12:01:00.000Z",
    plan_json: { executionClass: "live-generation", operationId: "operation-disable-1", sourceCommit: activeAuthority.sourceCommit, generationId: activeAuthority.generationId,
      plan: { operationId: "operation-disable-1", operation: "disable", deliveryClass: owner.deliveryClass, id: owner.extensionId, expectedRevision: 4, currentGenerationId: activeAuthority.generationId, targetGenerationId: activeAuthority.generationId, version: "1.0.0", artifactDigest: activeAuthority.artifactDigest } },
    authority_json: null, result_json: null
  };
  const state = {
    application_id: owner.applicationId, environment: owner.environment, delivery_class: owner.deliveryClass, extension_id: owner.extensionId,
    revision: 5, disposition: "active", active_generation_id: activeAuthority.generationId, active_generation: activeGeneration,
    rollback_generation_id: null, rollback_generation: null, rollback_compatibility_json: null, retained_generation: null,
    last_operation_id: null, last_receipt_id: null, state_digest: null, inventory_revision: 5
  };
  const query = vi.fn(async <T extends object>(text: string) => {
    queries.push(text);
    if (text.includes("from runtime_extension_operations")) return { rows: [operation] as unknown as T[] };
    if (text.includes("from runtime_extensions")) return { rows: [state] as unknown as T[] };
    if (text.startsWith("update runtime_extension_inventory_revisions")) return { rows: [{ revision: 6 }] as unknown as T[], rowCount: 1 };
    if (text.startsWith("update runtime_extensions set revision=") || text.startsWith("update runtime_extension_operations set phase='completed'")) return { rows: [] as T[], rowCount: 1 };
    return { rows: [] as T[], rowCount: 0 };
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  const pool: RuntimeExtensionPool = { connect: vi.fn(async () => session), query };
  return {
    store: new PostgresRuntimeExtensionStore(pool, { now: () => now }, digest("9"), { authorizationLifecycleProjector: projector }),
    projector
  };
}

function staticUninstallHarness(
  planCurrentGenerationId = "static-generation-retained",
  operationKind: "uninstall" | "update" = "uninstall",
  quarantineRecovery = operationKind === "update"
) {
  const queries: Array<readonly [string, readonly unknown[] | undefined]> = [];
  const projector = { project: vi.fn(async () => undefined) };
  const staticOwner = { applicationId: owner.applicationId, environment: owner.environment, deliveryClass: "platform-plugin" as const, extensionId: "module.sales" };
  const retained = {
    authority: "static-build", generationId: "static-generation-retained", version: "1.0.0", sourceCommit: "a".repeat(40),
    compositionChangePlanDigest: digest("b"), buildEvidenceDigest: digest("c"), applicationDigest: digest("d"), imageDigest: digest("e"),
    migrationRevision: 3, workerFencingToken: 4, receiptId: "static-receipt-retained"
  };
  const operation = {
    operation_id: "operation-static-uninstall-1", application_id: staticOwner.applicationId, environment: staticOwner.environment,
    delivery_class: staticOwner.deliveryClass, extension_id: staticOwner.extensionId, operation_kind: operationKind, request_digest: digest("1"),
    request_json: { applicationId: staticOwner.applicationId, environment: staticOwner.environment, extension: { deliveryClass: staticOwner.deliveryClass, id: staticOwner.extensionId }, operation: operationKind, targetVersion: "1.0.1", expectedRevision: 4, idempotencyKey: `static-${operationKind}-1`, correlationId: `correlation-static-${operationKind}-1` },
    authorization_json: { actor: { kind: "trusted-automation", identity: "test" }, decisionId: digest("2") }, expected_revision: 4,
    phase: "source-change-ready", lease_owner: "worker-1", lease_token: "lease-1", lease_expires_at: "2026-08-31T12:01:00.000Z",
    plan_json: {
      executionClass: "static-release", operationId: "operation-static-uninstall-1", sourceCommit: "f".repeat(40), generationId: "static-generation-removal",
      quarantineRecovery,
      sourceChange: { targetSourceCommit: "f".repeat(40), planDigest: digest("f") }, deployment: { buildRequestDigest: digest("0") },
      plan: { operationId: "operation-static-uninstall-1", operation: operationKind, deliveryClass: staticOwner.deliveryClass, id: staticOwner.extensionId, expectedRevision: 4, currentGenerationId: planCurrentGenerationId, targetGenerationId: "static-generation-removal", version: "1.0.1", artifactDigest: digest("9") }
    },
    authority_json: null, result_json: null
  };
  const state = {
    application_id: staticOwner.applicationId, environment: staticOwner.environment, delivery_class: staticOwner.deliveryClass, extension_id: staticOwner.extensionId,
    revision: 5, disposition: operationKind === "update" ? "quarantined" : "disabled", active_generation_id: null, active_generation: null, rollback_generation_id: null, rollback_generation: null,
    rollback_compatibility_json: null, retained_generation: retained, last_operation_id: null, last_receipt_id: null, state_digest: null, inventory_revision: 5
  };
  const receipt = {
    schemaVersion: 1, receiptId: "static-receipt-removal", operation: "promote", applicationId: staticOwner.applicationId, environment: staticOwner.environment,
    activeGenerationId: "static-generation-removal", previousGenerationId: retained.generationId, sourceCommit: "f".repeat(40), compositionChangePlanDigest: digest("f"),
    buildEvidenceDigest: digest("a"), applicationDigest: digest("b"), imageDigest: digest("c"), migrationRevision: 4, workerFencingToken: 5,
    promotionRevision: 6, revisionBefore: 5, revisionAfter: 6, rollbackWindow: { state: "open", windowId: "window-static-1", closesAt: "2026-08-31T12:10:00.000Z" }, contractCleanup: "blocked", occurredAt: "2026-08-31T12:00:00.000Z"
  } as const;
  const query = vi.fn(async <T extends object>(text: string, parameters?: readonly unknown[]) => {
    queries.push([text, parameters]);
    if (text.includes("from runtime_extension_operations")) return { rows: [operation] as unknown as T[] };
    if (text.includes("from runtime_extensions")) return { rows: [state] as unknown as T[] };
    if (text.startsWith("update runtime_extension_inventory_revisions")) return { rows: [{ revision: 6 }] as unknown as T[], rowCount: 1 };
    if (text.startsWith("update runtime_extensions set revision=") || text.startsWith("update runtime_extension_operations set phase='completed'")) return { rows: [] as T[], rowCount: 1 };
    return { rows: [] as T[], rowCount: 1 };
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  const pool: RuntimeExtensionPool = { connect: vi.fn(async () => session), query };
  return {
    store: new PostgresRuntimeExtensionStore(pool, { now: () => now }, digest("9"), { authorizationLifecycleProjector: projector }),
    projector, queries, retained, receipt
  };
}

function quarantinedLiveUpdateHarness() {
  const queries: Array<readonly [string, readonly unknown[] | undefined]> = [];
  const projector = { project: vi.fn(async () => undefined) };
  const targetAuthority = { ...authority, generationId: "generation-recovery" };
  const retained = { authority: "verified-bundle", ...authority, version: "1.0.0", receiptId: "receipt-retained" };
  const operation = {
    operation_id: "operation-recovery-1", application_id: owner.applicationId, environment: owner.environment, delivery_class: owner.deliveryClass, extension_id: owner.extensionId, operation_kind: "update", request_digest: digest("1"),
    request_json: { applicationId: owner.applicationId, environment: owner.environment, extension: { deliveryClass: owner.deliveryClass, id: owner.extensionId }, operation: "update", targetVersion: "1.0.1", expectedRevision: 4, idempotencyKey: "recovery-1", correlationId: "correlation-recovery-1" },
    authorization_json: { actor: { kind: "trusted-automation", identity: "test" }, decisionId: digest("2") }, expected_revision: 4,
    phase: "warming", lease_owner: "worker-1", lease_token: "lease-1", lease_expires_at: "2026-08-31T12:01:00.000Z",
    plan_json: { executionClass: "live-generation", operationId: "operation-recovery-1", sourceCommit: targetAuthority.sourceCommit, generationId: targetAuthority.generationId,
      plan: { operationId: "operation-recovery-1", operation: "update", deliveryClass: owner.deliveryClass, id: owner.extensionId, expectedRevision: 4, currentGenerationId: authority.generationId, targetGenerationId: targetAuthority.generationId, version: "1.0.1", artifactDigest: targetAuthority.artifactDigest } },
    authority_json: targetAuthority, result_json: null
  };
  const state = {
    application_id: owner.applicationId, environment: owner.environment, delivery_class: owner.deliveryClass, extension_id: owner.extensionId,
    revision: 5, disposition: "quarantined", active_generation_id: null, active_generation: null, rollback_generation_id: null, rollback_generation: null,
    rollback_compatibility_json: null, retained_generation: retained, last_operation_id: null, last_receipt_id: null, state_digest: null, inventory_revision: 5
  };
  const generation = {
    generation_id: targetAuthority.generationId, version: "1.0.1", authority_json: targetAuthority, authority_digest: `sha256:${createHash("sha256").update(canonicalJson(targetAuthority)).digest("hex")}`,
    state: "warming", server_generation_id: targetAuthority.generationId, ui_generation_id: targetAuthority.generationId, storage_generation_id: targetAuthority.generationId,
    activation_json: { metadata: {}, settings: {}, storageSchemaVersions: {} }, compatibility_json: { status: "compatible", windowId: "window-recovery", closesAt: "2026-08-31T12:10:00.000Z", migrationDigest: digest("f"), dataRevision: 7 },
    readiness_token: "readiness-recovery", readiness_expires_at: "2026-08-31T12:01:00.000Z", staged_revision: 5, receipt_id: null
  };
  const query = vi.fn(async <T extends object>(text: string, parameters?: readonly unknown[]) => {
    queries.push([text, parameters]);
    if (text.includes("from runtime_extension_operations")) return { rows: [operation] as unknown as T[] };
    if (text.includes("from runtime_extensions")) return { rows: [state] as unknown as T[] };
    if (text.includes("from runtime_extension_generations")) return { rows: [generation] as unknown as T[] };
    if (text.startsWith("update runtime_extension_inventory_revisions")) return { rows: [{ revision: 6 }] as unknown as T[], rowCount: 1 };
    return { rows: [] as T[], rowCount: 1 };
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  const pool: RuntimeExtensionPool = { connect: vi.fn(async () => session), query };
  return { store: new PostgresRuntimeExtensionStore(pool, { now: () => now }, digest("9"), { authorizationLifecycleProjector: projector }), projector, queries, retained, targetAuthority };
}

describe("PostgresRuntimeExtensionStore rollback readiness", () => {
  it("rejects expired or mixed fresh readiness before any mutation", async () => {
    for (const [invalid, code] of [
      [stage({ readiness: { ...stage().readiness, expiresAt: "2026-08-31T12:00:00.000Z" } }), "READINESS_EXPIRED"],
      [stage({ readiness: { ...stage().readiness, uiGenerationId: "generation-other" } }), "GENERATION_MISMATCH"]
    ]) {
      const value = rollbackHarness();
      await expect(value.store.rollbackGeneration("operation-rollback-1", "lease-1", invalid as ReturnType<typeof stage>)).rejects.toMatchObject({ code });
      expectNoDurableMutation(value.queries);
    }
  });

  it("rejects plan and retained-authority mismatches inertly", async () => {
    const wrongPlan = rollbackHarness({ planTarget: "generation-other" });
    await expect(wrongPlan.store.rollbackGeneration("operation-rollback-1", "lease-1", stage())).rejects.toMatchObject({ code: "GENERATION_MISMATCH" });
    expectNoDurableMutation(wrongPlan.queries);

    const wrongAuthority = rollbackHarness({ targetAuthority: { ...authority, artifactDigest: digest("z") } });
    await expect(wrongAuthority.store.rollbackGeneration("operation-rollback-1", "lease-1", stage())).rejects.toMatchObject({ code: "GENERATION_MISMATCH" });
    expectNoDurableMutation(wrongAuthority.queries);

    const staleLease = rollbackHarness();
    await expect(staleLease.store.rollbackGeneration("operation-rollback-1", "lease-1", stage({ readiness: { ...stage().readiness, leaseToken: "old-readiness" } }))).rejects.toMatchObject({ code: "READINESS_EXPIRED" });
    expectNoDurableMutation(staleLease.queries);
  });

  it("rechecks readiness after waiting for the rollback identity lock", async () => {
    const value = rollbackHarness({ onAdvisoryLock: () => value.expireReadiness() });

    await expect(value.store.rollbackGeneration("operation-rollback-1", "lease-1", stage())).rejects.toMatchObject({ code: "READINESS_EXPIRED" });
    expectNoDurableMutation(value.queries);
  });

  it.each([
    ["wrong retained owner", { authority: "verified-bundle", ...authority, applicationId: "customer-other", version: "1.0.0", receiptId: "receipt-retained" }, undefined],
    ["wrong retained authority marker", { authority: "unverified-bundle", ...authority, version: "1.0.0", receiptId: "receipt-retained" }, undefined],
    ["wrong retained artifact authority", { authority: "verified-bundle", ...authority, artifactDigest: digest("z"), version: "1.0.0", receiptId: "receipt-retained" }, undefined],
    ["missing retained receipt", { authority: "verified-bundle", ...authority, version: "1.0.0" }, undefined],
    ["null generation receipt", undefined, null]
  ])("rejects %s evidence before durable rollback mutation", async (_label, retained, targetReceiptId) => {
    const value = rollbackHarness({ retained, targetReceiptId });

    await expect(value.store.rollbackGeneration("operation-rollback-1", "lease-1", stage())).rejects.toMatchObject({ code: "GENERATION_MISMATCH" });
    expectNoDurableMutation(value.queries);
  });

  it("rejects an irreversible current rollback decision with its decision identity", async () => {
    const decisionId = "decision-rollback-closed";
    const value = rollbackHarness({
      rollbackGenerationId: null,
      retained: null,
      rollbackCompatibility: {
        status: "irreversible",
        decisionId,
        reason: "The prior data shape cannot be restored.",
        migrationDigest: digest("f"),
        dataRevision: 7
      }
    });

    await expect(value.store.rollbackGeneration("operation-rollback-1", "lease-1", stage())).rejects.toMatchObject({
      code: "ROLLBACK_BLOCKED",
      message: expect.stringContaining(decisionId)
    });
    expectNoDurableMutation(value.queries);
  });

  it("rejects an ordinary rollback from recovered active state with no rollback pointer", async () => {
    const value = rollbackHarness({ activeGenerationId: "generation-recovery", rollbackGenerationId: null, retained: null });

    await expect(value.store.rollbackGeneration("operation-rollback-1", "lease-1", stage())).rejects.toMatchObject({ code: "GENERATION_MISMATCH" });
    expectNoDurableMutation(value.queries);
  });

  it("refreshes exact retained readiness without reusing its historical compatibility clock", async () => {
    const value = rollbackHarness();
    const receipt = await value.store.rollbackGeneration("operation-rollback-1", "lease-1", stage());
    expect(receipt.generationId).toBe(authority.generationId);
    expect(value.queries.some((query) => query.startsWith("update runtime_extension_generations set readiness_token"))).toBe(true);
    expect(value.projector.project).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.anything(),
      runtimeGenerationIds: [authority.generationId],
      transition: expect.objectContaining({ operation: "rollback", lifecycleState: "active", revision: 6 })
    }));
  });

  it("fails closed before commit when a Hot Application terminal transition has no projector", async () => {
    const value = rollbackHarness({ withoutProjector: true });

    await expect(value.store.rollbackGeneration("operation-rollback-1", "lease-1", stage())).rejects.toMatchObject({
      code: "STATE_INVALID",
      message: expect.stringContaining("authorization lifecycle projector")
    });
    expect(value.queries).toContain("rollback");
    expect(value.queries).not.toContain("commit");
    expect(value.queries.some((query) => query.startsWith("update runtime_extension_operations set phase='completed'"))).toBe(false);
  });
});

describe("PostgresRuntimeExtensionStore Hot Application dispositions", () => {
  it("projects a complete verified retained-generation event for disable", async () => {
    const value = hotApplicationDispositionHarness();

    await value.store.disableGeneration("operation-disable-1", "lease-1");

    expect(value.projector.project).toHaveBeenCalledWith(expect.objectContaining({
      runtimeGenerationIds: [activeAuthority.generationId],
      transition: expect.objectContaining({
        operation: "disable",
        lifecycleState: "disabled",
        evidence: expect.objectContaining({
          sourceCommit: activeAuthority.sourceCommit,
          generationId: activeAuthority.generationId,
          artifactDigest: activeAuthority.artifactDigest,
          manifestDigest: activeAuthority.manifestDigest,
          catalogDigest: activeAuthority.catalogDigest,
          provenanceDigest: activeAuthority.provenanceDigest,
          sbomDigest: activeAuthority.sbomDigest
        })
      })
    }));
  });

  it("closes live rollback and preserves retained evidence only for the quarantined recovery projection", async () => {
    const value = quarantinedLiveUpdateHarness();

    const receipt = await value.store.activateGeneration("operation-recovery-1", "lease-1");
    const update = value.queries.find(([text]) => text.startsWith("update runtime_extensions set revision="));

    expect(receipt.rollback).toBe("unavailable");
    expect(update?.[1]?.[7]).toBeNull();
    expect(update?.[1]?.[8]).toBeNull();
    expect(update?.[1]?.[12]).toBeNull();
    expect(value.projector.project).toHaveBeenCalledWith(expect.objectContaining({
      runtimeGenerationIds: [value.targetAuthority.generationId],
      updateCompatibility: "incompatible",
      priorGenerationEvidence: value.retained
    }));
  });
});

describe("PostgresRuntimeExtensionStore static retained uninstall", () => {
  it("preserves disabled retained static evidence for uninstall projection", async () => {
    const value = staticUninstallHarness();

    await value.store.completeStaticRelease("operation-static-uninstall-1", "lease-1", value.receipt);

    const update = value.queries.find(([text]) => text.startsWith("update runtime_extensions set revision="));
    expect(JSON.parse(String(update?.[1]?.[10]))).toEqual(value.retained);
    expect(value.projector.project).toHaveBeenCalledWith(expect.objectContaining({
      runtimeGenerationIds: [value.retained.generationId],
      transition: expect.objectContaining({ operation: "uninstall", lifecycleState: "removed" })
    }));
  });

  it("rejects a static uninstall whose plan does not bind retained generation", async () => {
    const value = staticUninstallHarness("static-generation-other");

    await expect(value.store.completeStaticRelease("operation-static-uninstall-1", "lease-1", value.receipt)).rejects.toMatchObject({ code: "GENERATION_MISMATCH" });
    expect(value.queries.some(([text]) => text.startsWith("update runtime_extensions set revision="))).toBe(false);
    expect(value.projector.project).not.toHaveBeenCalled();
  });

  it("closes static rollback despite an open supervisor receipt after quarantined recovery", async () => {
    const value = staticUninstallHarness("static-generation-retained", "update");

    await value.store.completeStaticRelease("operation-static-uninstall-1", "lease-1", value.receipt);
    const update = value.queries.find(([text]) => text.startsWith("update runtime_extensions set revision="));

    expect(update?.[1]?.[8]).toBeNull();
    expect(update?.[1]?.[9]).toBeNull();
    expect(update?.[1]?.[10]).toBeNull();
    expect(value.projector.project).toHaveBeenCalledWith(expect.objectContaining({
      runtimeGenerationIds: [value.receipt.activeGenerationId],
      updateCompatibility: "incompatible",
      priorGenerationEvidence: value.retained
    }));
  });

  it("rejects a static recovery plan that omits its durable quarantine marker", async () => {
    const value = staticUninstallHarness("static-generation-retained", "update", false);

    await expect(value.store.completeStaticRelease("operation-static-uninstall-1", "lease-1", value.receipt))
      .rejects.toMatchObject({ code: "GENERATION_MISMATCH" });
    expect(value.queries.some(([text]) => text.startsWith("update runtime_extensions set revision="))).toBe(false);
  });
});
