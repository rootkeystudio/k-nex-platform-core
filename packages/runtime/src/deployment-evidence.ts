import { createHash } from "node:crypto";

import { DeploymentReceiptSchema, RuntimeInventorySchema, canonicalJson, type DeploymentReceipt, type RuntimeInventory } from "@k-nex/contracts";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function observeRuntimeInventory(value: RuntimeInventory): RuntimeInventory {
  return freeze(RuntimeInventorySchema.parse(structuredClone(value)));
}

export function runtimeInventoryDigest(inventory: RuntimeInventory): string {
  const observed = RuntimeInventorySchema.parse(inventory);
  return `sha256:${createHash("sha256").update(canonicalJson(observed)).digest("hex")}`;
}

export function createDeploymentReceipt(input: {
  readonly inventory: RuntimeInventory;
  readonly deploymentId: string;
  readonly deployedAt: string;
  readonly approvedBy: DeploymentReceipt["approvedBy"];
  readonly smoke: DeploymentReceipt["smoke"];
}): DeploymentReceipt {
  const inventory = RuntimeInventorySchema.parse(input.inventory);
  return freeze(DeploymentReceiptSchema.parse({
    schemaVersion: 1,
    deploymentId: input.deploymentId,
    applicationId: inventory.applicationId,
    environment: inventory.environment,
    deployedAt: input.deployedAt,
    approvedBy: input.approvedBy,
    artifactDigest: inventory.artifactDigest,
    inventoryDigest: runtimeInventoryDigest(inventory),
    migrationRevision: inventory.migrationRevision,
    smoke: input.smoke,
    readiness: inventory.health.status
  }));
}

export function reconcileDeploymentReceipt(receipt: DeploymentReceipt, inventory: RuntimeInventory): boolean {
  const parsedReceipt = DeploymentReceiptSchema.parse(receipt);
  const parsedInventory = RuntimeInventorySchema.parse(inventory);
  return parsedReceipt.applicationId === parsedInventory.applicationId && parsedReceipt.environment === parsedInventory.environment &&
    parsedReceipt.artifactDigest === parsedInventory.artifactDigest && parsedReceipt.inventoryDigest === runtimeInventoryDigest(parsedInventory) &&
    parsedReceipt.migrationRevision === parsedInventory.migrationRevision && parsedReceipt.readiness === parsedInventory.health.status &&
    (parsedReceipt.smoke.status === "passed") === (parsedReceipt.readiness === "ready");
}
