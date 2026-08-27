import { gt, satisfies, valid, validRange } from "semver";

import { PackageReleaseManifestSchema, type DeploymentReceipt, type PackageReleaseManifest, type RuntimeInventory } from "@k-nex/contracts";

import { runtimeInventoryDigest, type DeploymentEvidenceAuthority, type VerifiedDeploymentEvidence } from "./deployment-evidence.js";

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
  readonly targetIntegrity: string;
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
  readonly #authority: DeploymentEvidenceAuthority;

  constructor(supportManifest: PackageReleaseManifest, authority: DeploymentEvidenceAuthority) {
    const parsed = PackageReleaseManifestSchema.parse(supportManifest);
    this.#supportedReleases = new Set(parsed.supportWindow.supportedReleases);
    this.#authority = authority;
  }

  ingest(evidence: VerifiedDeploymentEvidence): void {
    let deployment: Readonly<{ receipt: DeploymentReceipt; inventory: RuntimeInventory }>;
    try { deployment = this.#authority.read(evidence); } catch { throw new FleetEvidenceError("EVIDENCE_INVALID", "Fleet ingestion requires evidence from its trusted deployment authority."); }
    const { receipt, inventory } = deployment;
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

  planSecurityPatch(packageName: string, vulnerableRange: string, targetVersion: string, targetReleaseManifest: PackageReleaseManifest): readonly SecurityPatchPlan[] {
    const targetRelease = PackageReleaseManifestSchema.parse(targetReleaseManifest);
    const target = targetRelease.packages.find((entry) => entry.package === packageName);
    if (valid(targetVersion, { loose: false }) === null || target?.version !== targetVersion) {
      throw new FleetEvidenceError("PATCH_INVALID", "Security patch target must be an exact version outside the vulnerable range.");
    }
    return Object.freeze(this.affected(packageName, vulnerableRange).filter(({ inventory }) => {
      const current = inventory.packages.find((entry) => entry.package === packageName)!;
      return current.version !== targetVersion || current.integrity !== target.integrity;
    }).map(({ inventory }) => {
      const current = inventory.packages.find((entry) => entry.package === packageName)!;
      if (gt(current.version, targetVersion, { loose: false })) throw new FleetEvidenceError("PATCH_INVALID", "Security patch target must not regress an affected deployment.");
      return Object.freeze({
        applicationId: inventory.applicationId,
        repository: inventory.repository,
        environment: inventory.environment,
        package: packageName,
        currentVersion: current.version,
        targetVersion,
        targetIntegrity: target.integrity,
        baseInventoryDigest: runtimeInventoryDigest(inventory),
        operations: Object.freeze(["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"] as const)
      });
    }));
  }
}

export function restoredInventoryMatches(expected: RuntimeInventory, restored: RuntimeInventory): boolean {
  return runtimeInventoryStateDigest(expected) === runtimeInventoryStateDigest(restored);
}

export function runtimeInventoryStateDigest(inventory: RuntimeInventory): string {
  const parsed = structuredClone(inventory);
  parsed.observedAt = "2000-01-01T00:00:00.000Z";
  return runtimeInventoryDigest(parsed);
}
