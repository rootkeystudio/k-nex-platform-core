import { createHash } from "node:crypto";

import { canonicalJson, type StaticDeploymentReceipt } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  PostgresRuntimeExtensionStore,
  RuntimeExtensionStoreError,
  type RuntimeExtensionPool,
  type RuntimeExtensionSession,
  type StaticHostPlatformPlugin
} from "../src/runtime-extension-store.js";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const applicationId = "customer-alpha";
const environment = "production";
const applicationGenerationId = "customer-alpha-green-12";
const plugins: readonly StaticHostPlatformPlugin[] = Object.freeze([
  { id: "module.sales", package: { name: "@k-nex/module-sales", version: "1.0.0", integrity: digest("sales") }, runtimeGenerationId: "sales-generation-1" },
  { id: "provider.realtime.socketio", package: { name: "@k-nex/provider-realtime-socketio", version: "1.0.0", integrity: digest("realtime") }, runtimeGenerationId: "realtime-generation-1" }
]);
const hostInventoryDigest = digest(canonicalJson({ applicationId, environment, platformPlugins: plugins }));
const initialGeneration = {
  generationId: applicationGenerationId,
  sourceCommit: "a".repeat(40),
  compositionChangePlanDigest: digest("composition"),
  buildEvidenceDigest: digest("build"),
  applicationDigest: digest("application"),
  imageDigest: digest("image"),
  imageReference: `ghcr.io/k-nex/customer-alpha@${digest("image")}`,
  migrationRevision: 12
} as const;
const receipt: StaticDeploymentReceipt = {
  schemaVersion: 1,
  receiptId: "static-promote-customer-alpha-12",
  operation: "promote",
  applicationId,
  environment,
  activeGenerationId: applicationGenerationId,
  previousGenerationId: "customer-alpha-blue-11",
  sourceCommit: "a".repeat(40),
  compositionChangePlanDigest: digest("composition"),
  buildEvidenceDigest: digest("build"),
  applicationDigest: digest("application"),
  imageDigest: digest("image"),
  migrationRevision: 12,
  workerFencingToken: 8,
  promotionRevision: 12,
  revisionBefore: 11,
  revisionAfter: 12,
  rollbackWindow: { state: "open", windowId: "rollback-window-12", closesAt: "2026-09-06T00:00:00.000Z" },
  contractCleanup: "blocked",
  occurredAt: "2026-09-05T00:00:00.000Z"
};

function harness(options: Readonly<{ authorityGenerationId?: string; racedInsert?: boolean; receiptMode?: boolean; storeHostDigest?: string }> = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const statements: string[] = [];
  let inventoryRevision = 0;
  const query = vi.fn(async <T extends object>(text: string, values?: readonly unknown[]) => {
    statements.push(text);
    if (["begin", "commit", "rollback"].includes(text) || text.startsWith("select pg_advisory_xact_lock")) return { rows: [] as T[] };
    if (text.includes("from runtime_static_deployments d")) {
      const generationId = options.authorityGenerationId ?? applicationGenerationId;
      const deploymentReceipt = options.receiptMode ? receipt : undefined;
      return { rows: [{
        revision: deploymentReceipt?.revisionAfter ?? 0,
        active_generation_id: generationId,
        active_generation: { ...initialGeneration, generationId },
        active_execution_generation: generationId,
        fencing_token: receipt.workerFencingToken,
        promotion_revision: deploymentReceipt?.promotionRevision ?? 0,
        lease_expires_at: "2026-09-06T00:00:00.000Z",
        event_json: deploymentReceipt ?? null
      }] as unknown as T[] };
    }
    if (text.includes("select *, 0::int as inventory_revision from runtime_extensions")) return { rows: rows as T[] };
    if (text.startsWith("insert into runtime_extension_inventory_revisions")) return { rows: [] as T[], rowCount: 1 };
    if (text.startsWith("update runtime_extension_inventory_revisions")) {
      inventoryRevision += 1;
      return { rows: [{ revision: inventoryRevision }] as T[], rowCount: 1 };
    }
    if (text.startsWith("insert into runtime_extensions")) {
      if (options.racedInsert) return { rows: [] as T[], rowCount: 0 };
      rows.push({
        application_id: applicationId,
        environment,
        delivery_class: "platform-plugin",
        extension_id: values![2],
        revision: 1,
        disposition: "active",
        active_generation_id: values![3],
        active_generation: JSON.parse(String(values![4])),
        rollback_generation_id: null,
        rollback_generation: null,
        retained_generation: null,
        last_operation_id: values![5],
        last_receipt_id: values![6],
        state_digest: values![7],
        inventory_revision: inventoryRevision
      });
      return { rows: [{ extension_id: values![2] }] as unknown as T[], rowCount: 1 };
    }
    if (text.includes("select runtime_extensions.*")) {
      return { rows: rows.map((row) => ({ ...row, inventory_revision: inventoryRevision })) as T[] };
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  const pool: RuntimeExtensionPool = { connect: vi.fn(async () => session), query };
  const store = new PostgresRuntimeExtensionStore(pool, { now: () => new Date("2026-09-05T00:01:00.000Z") }, options.storeHostDigest ?? hostInventoryDigest, {
    sharedStaticGenerationRebinder: { rebind: vi.fn(async () => undefined) }
  });
  const reconcile = () => store.reconcileStaticHostInventory({
    applicationId,
    environment,
    platformPlugins: plugins,
    deployment: options.receiptMode
      ? { kind: "receipt", receipt }
      : { kind: "initial", generation: initialGeneration, workerFencingToken: receipt.workerFencingToken }
  });
  return { reconcile, rows, statements };
}

describe("PostgresRuntimeExtensionStore static host inventory reconciliation", () => {
  it("initializes from locked revision-zero deployment and live fence with distinct plugin runtime generations", async () => {
    const value = harness();
    const inventory = await value.reconcile();

    expect(Object.keys(inventory.extensions.platformPlugins)).toEqual(["module.sales", "provider.realtime.socketio"]);
    expect(inventory.extensions.platformPlugins["module.sales"]?.activeGeneration.generationId).toBe("sales-generation-1");
    expect(inventory.extensions.platformPlugins["provider.realtime.socketio"]?.activeGeneration.generationId).toBe("realtime-generation-1");
    expect(value.statements.some((statement) => statement.includes("for update of d, f"))).toBe(true);
  });

  it("accepts a later current supervisor receipt without inventing another lifecycle transition", async () => {
    const value = harness({ receiptMode: true });

    await expect(value.reconcile()).resolves.toMatchObject({ revision: 1, hostInventoryDigest });
    expect(value.rows.every((row) => row.last_receipt_id === receipt.receiptId)).toBe(true);
  });

  it("replays an exact initialized projection without another write", async () => {
    const value = harness();
    await value.reconcile();
    const inserts = value.statements.filter((statement) => statement.startsWith("insert into runtime_extensions")).length;

    await value.reconcile();

    expect(value.statements.filter((statement) => statement.startsWith("insert into runtime_extensions"))).toHaveLength(inserts);
    expect(value.statements.filter((statement) => statement.startsWith("update runtime_extension_inventory_revisions"))).toHaveLength(1);
  });

  it("rejects deployment authority that differs from the durable receipt", async () => {
    const value = harness({ authorityGenerationId: "customer-alpha-forged-12" });

    await expect(value.reconcile()).rejects.toMatchObject<Partial<RuntimeExtensionStoreError>>({ code: "GENERATION_MISMATCH" });
    expect(value.statements).toContain("rollback");
    expect(value.rows).toHaveLength(0);
  });

  it("rejects code inventory that differs from configured host digest before DB access", async () => {
    const value = harness({ storeHostDigest: digest("other-host") });

    await expect(value.reconcile()).rejects.toMatchObject<Partial<RuntimeExtensionStoreError>>({ code: "GENERATION_MISMATCH" });
    expect(value.statements).toHaveLength(0);
  });

  it("rolls back when another initializer wins the insert race", async () => {
    const value = harness({ racedInsert: true });

    await expect(value.reconcile()).rejects.toMatchObject<Partial<RuntimeExtensionStoreError>>({ code: "REVISION_CONFLICT" });
    expect(value.statements).toContain("rollback");
    expect(value.statements).not.toContain("commit");
  });
});
