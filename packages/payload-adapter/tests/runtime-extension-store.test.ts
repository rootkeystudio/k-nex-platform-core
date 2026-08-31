import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import { PostgresRuntimeExtensionStore, type RuntimeExtensionPool, type RuntimeExtensionSession } from "../src/runtime-extension-store.js";

const now = new Date("2026-08-31T12:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const owner = { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application" as const, extensionId: "app.sales-live" };
const authority = { ...owner, generationId: "generation-retained", sourceCommit: "a".repeat(40), artifactDigest: digest("a"), manifestDigest: digest("b"), catalogDigest: digest("c"), provenanceDigest: digest("d"), sbomDigest: digest("e") };
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
  rollbackGenerationId?: string | null;
  targetReceiptId?: string | null;
  rollbackCompatibility?: Record<string, unknown>;
  onAdvisoryLock?: () => void;
}> = {}) {
  const queries: string[] = [];
  let currentNow = now;
  const retained = overrides.retained === undefined
    ? { authority: "verified-bundle", ...authority, version: "1.0.0", receiptId: "receipt-retained" }
    : overrides.retained;
  const operation = {
    operation_id: "operation-rollback-1", application_id: owner.applicationId, environment: owner.environment, delivery_class: owner.deliveryClass, extension_id: owner.extensionId, operation_kind: "rollback", request_digest: digest("1"),
    request_json: { applicationId: owner.applicationId, environment: owner.environment, extension: { deliveryClass: owner.deliveryClass, id: owner.extensionId }, operation: "rollback", targetVersion: "1.0.0", expectedRevision: 4, idempotencyKey: "rollback-1", correlationId: "correlation-1" },
    authorization_json: { actor: { kind: "trusted-automation", identity: "test" }, decisionId: digest("2") }, expected_revision: 4,
    phase: "planning", lease_owner: "worker-1", lease_token: "lease-1", lease_expires_at: "2026-08-31T12:01:00.000Z",
    plan_json: { executionClass: "live-generation", operationId: "operation-rollback-1", sourceCommit: authority.sourceCommit, generationId: overrides.planTarget ?? authority.generationId,
      plan: { operationId: "operation-rollback-1", operation: "rollback", deliveryClass: owner.deliveryClass, id: owner.extensionId, expectedRevision: 4, currentGenerationId: "generation-active", targetGenerationId: overrides.planTarget ?? authority.generationId, version: "1.0.0", artifactDigest: authority.artifactDigest } },
    authority_json: null, result_json: null
  };
  const state = {
    application_id: owner.applicationId, environment: owner.environment, delivery_class: owner.deliveryClass, extension_id: owner.extensionId,
    revision: 5, disposition: "active", active_generation_id: "generation-active", rollback_generation_id: overrides.rollbackGenerationId === undefined ? authority.generationId : overrides.rollbackGenerationId,
    active_generation: { authority: "verified-bundle", generationId: "generation-active" }, rollback_generation: retained,
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
  const pool: RuntimeExtensionPool = { connect: vi.fn(async () => session), query };
  return {
    store: new PostgresRuntimeExtensionStore(pool, { now: () => currentNow }, digest("9")),
    queries,
    expireReadiness: () => { currentNow = new Date("2026-08-31T12:02:00.000Z"); }
  };
}

function expectNoDurableMutation(queries: readonly string[]): void {
  expect(queries.some((query) => /^\s*(?:insert|update|delete)\b/iu.test(query))).toBe(false);
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

  it("refreshes exact retained readiness without reusing its historical compatibility clock", async () => {
    const value = rollbackHarness();
    const receipt = await value.store.rollbackGeneration("operation-rollback-1", "lease-1", stage());
    expect(receipt.generationId).toBe(authority.generationId);
    expect(value.queries.some((query) => query.startsWith("update runtime_extension_generations set readiness_token"))).toBe(true);
  });
});
