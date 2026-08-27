import { gt, satisfies, valid, validRange } from "semver";

import { PackageReleaseManifestSchema, type DeploymentReceipt, type PackageReleaseManifest, type RuntimeInventory } from "@k-nex/contracts";

import { reconcileDeploymentReceipt, runtimeInventoryDigest } from "./deployment-evidence.js";

export class FleetEvidenceError extends Error {
  constructor(readonly code: "CONFLICT" | "EVIDENCE_INVALID" | "PATCH_INVALID", message: string) {
    super(message);
    this.name = "FleetEvidenceError";
  }
}

export interface FleetDeployment {
  readonly receipt: DeploymentReceipt;
  readonly inventory: RuntimeInventory;
}

export interface SecurityPatchPlan {
  readonly applicationId: string;
  readonly repository: string;
  readonly environment: string;
  readonly package: string;
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly baseInventoryDigest: string;
  readonly operations: readonly ["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"];
}

function compare(left: FleetDeployment, right: FleetDeployment): number {
  return `${left.inventory.applicationId}\u0000${left.inventory.environment}`.localeCompare(`${right.inventory.applicationId}\u0000${right.inventory.environment}`);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export class FleetRegistry {
  readonly #deployments = new Map<string, FleetDeployment>();
  readonly #supportedReleases: ReadonlySet<string>;

  constructor(supportManifest: PackageReleaseManifest) {
    const parsed = PackageReleaseManifestSchema.parse(supportManifest);
    this.#supportedReleases = new Set(parsed.supportWindow.supportedReleases);
  }

  ingest(receipt: DeploymentReceipt, inventory: RuntimeInventory): void {
    if (!reconcileDeploymentReceipt(receipt, inventory)) throw new FleetEvidenceError("EVIDENCE_INVALID", "Fleet ingestion requires a reconciled deployment receipt and runtime inventory.");
    if (!this.#supportedReleases.has(inventory.platformRelease)) throw new FleetEvidenceError("EVIDENCE_INVALID", "Fleet ingestion rejects a platform release outside the declared support window.");
    const key = `${inventory.applicationId}\u0000${inventory.environment}`;
    const existing = this.#deployments.get(key);
    if (existing !== undefined && existing.receipt.deploymentId === receipt.deploymentId) {
      if (runtimeInventoryDigest(existing.inventory) !== runtimeInventoryDigest(inventory)) throw new FleetEvidenceError("CONFLICT", "Deployment identity cannot be rebound to different inventory.");
      return;
    }
    if (existing !== undefined && existing.receipt.deployedAt >= receipt.deployedAt) throw new FleetEvidenceError("CONFLICT", "Fleet evidence cannot regress or replace an equally new deployment.");
    this.#deployments.set(key, freeze({ receipt: structuredClone(receipt), inventory: structuredClone(inventory) }));
  }

  list(): readonly FleetDeployment[] {
    return Object.freeze([...this.#deployments.values()].sort(compare));
  }

  affected(packageName: string, vulnerableRange: string): readonly FleetDeployment[] {
    if (validRange(vulnerableRange, { loose: false }) === null) throw new FleetEvidenceError("PATCH_INVALID", "Vulnerable package range is invalid.");
    return Object.freeze(this.list().filter(({ inventory }) => inventory.packages.some((entry) =>
      entry.package === packageName && satisfies(entry.version, vulnerableRange, { loose: false, includePrerelease: false })
    )));
  }

  planSecurityPatch(packageName: string, vulnerableRange: string, targetVersion: string): readonly SecurityPatchPlan[] {
    if (valid(targetVersion, { loose: false }) === null || satisfies(targetVersion, vulnerableRange, { loose: false, includePrerelease: false })) {
      throw new FleetEvidenceError("PATCH_INVALID", "Security patch target must be an exact version outside the vulnerable range.");
    }
    return Object.freeze(this.affected(packageName, vulnerableRange).map(({ inventory }) => {
      const current = inventory.packages.find((entry) => entry.package === packageName)!;
      if (!gt(targetVersion, current.version, { loose: false })) throw new FleetEvidenceError("PATCH_INVALID", "Security patch target must advance every affected deployment.");
      return Object.freeze({
        applicationId: inventory.applicationId,
        repository: inventory.repository,
        environment: inventory.environment,
        package: packageName,
        currentVersion: current.version,
        targetVersion,
        baseInventoryDigest: runtimeInventoryDigest(inventory),
        operations: Object.freeze(["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"] as const)
      });
    }));
  }
}

export function restoredInventoryMatches(expected: RuntimeInventory, restored: RuntimeInventory): boolean {
  return runtimeInventoryDigest(expected) === runtimeInventoryDigest(restored);
}
