import { gt, satisfies, valid, validRange } from "semver";

import { canonicalJson, type DeploymentReceipt, type RuntimeInventory } from "@k-nex/contracts";

import { runtimeInventoryDigest, type ApplicationBundleAuthority, type DeploymentEvidenceAuthority, type PackageReleaseManifestAuthority, type VerifiedApplicationBundle, type VerifiedDeploymentEvidence, type VerifiedPackageReleaseManifest } from "./deployment-evidence.js";

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
  readonly targetRelease: string;
  readonly targetReleaseManifestDigest: string;
  readonly targetFrameworkDigest: string;
  readonly targetMigrationPlanDigest: string;
  readonly targetMigrationRevision: number;
  readonly targetClosure: readonly { readonly package: string; readonly version: string; readonly integrity: string }[];
  readonly targetDeploymentClosure: readonly { readonly package: string; readonly version: string; readonly integrity: string }[];
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
  readonly #supportedReleases: Set<string>;
  readonly #authority: DeploymentEvidenceAuthority;
  readonly #releaseAuthority: PackageReleaseManifestAuthority;
  readonly #applicationAuthority: ApplicationBundleAuthority;
  readonly #patchPlans = new WeakSet<object>();

  constructor(supportRelease: VerifiedPackageReleaseManifest, releaseAuthority: PackageReleaseManifestAuthority, applicationAuthority: ApplicationBundleAuthority, authority: DeploymentEvidenceAuthority) {
    const parsed = releaseAuthority.read(supportRelease).manifest;
    this.#supportedReleases = new Set(parsed.supportWindow.supportedReleases);
    this.#releaseAuthority = releaseAuthority;
    this.#applicationAuthority = applicationAuthority;
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
    if (existing !== undefined && Date.parse(existing.receipt.deployedAt) >= Date.parse(receipt.deployedAt)) throw new FleetEvidenceError("CONFLICT", "Fleet evidence cannot regress or replace an equally new deployment.");
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

  planSecurityPatch(packageName: string, vulnerableRange: string, targetVersion: string, targetReleaseToken: VerifiedPackageReleaseManifest, targetApplications: readonly VerifiedApplicationBundle[]): readonly SecurityPatchPlan[] {
    let verifiedTarget: ReturnType<PackageReleaseManifestAuthority["read"]>;
    try { verifiedTarget = this.#releaseAuthority.read(targetReleaseToken); } catch { throw new FleetEvidenceError("EVIDENCE_INVALID", "Security patch target requires a verified package release manifest."); }
    const targetRelease = verifiedTarget.manifest;
    const applications = new Map(targetApplications.map((token) => {
      const value = this.#applicationAuthority.read(token);
      return [value.bundle.applicationId, value] as const;
    }));
    const target = targetRelease.packages.find((entry) => entry.package === packageName);
    if (validRange(vulnerableRange, { loose: false }) === null) throw new FleetEvidenceError("PATCH_INVALID", "Vulnerable package range is invalid.");
    if (valid(targetVersion, { loose: false }) === null) throw new FleetEvidenceError("PATCH_INVALID", "Security patch target must be an exact semantic version.");
    if (target?.version !== targetVersion) throw new FleetEvidenceError("PATCH_INVALID", "Security patch target is absent from the trusted release manifest.");
    if (satisfies(targetVersion, vulnerableRange, { loose: false, includePrerelease: false })) throw new FleetEvidenceError("PATCH_INVALID", "Security patch target remains within the vulnerable range.");
    const plans = this.affected(packageName, vulnerableRange).filter(({ inventory }) => {
      const current = inventory.packages.find((entry) => entry.package === packageName)!;
      return current.version !== targetVersion || current.integrity !== target.integrity;
    }).map(({ inventory }) => {
      const application = applications.get(inventory.applicationId);
      if (application === undefined || application.bundle.release !== targetRelease.release.version || application.bundle.releaseManifestDigest !== verifiedTarget.digest) {
        throw new FleetEvidenceError("EVIDENCE_INVALID", `Security patch target requires a verified application bundle for ${inventory.applicationId}.`);
      }
      const current = inventory.packages.find((entry) => entry.package === packageName)!;
      if (gt(current.version, targetVersion, { loose: false })) throw new FleetEvidenceError("PATCH_INVALID", "Security patch target must not regress an affected deployment.");
      const targetClosure = Object.freeze([...targetRelease.packages].map(({ package: targetPackage, version, integrity }) => Object.freeze({ package: targetPackage, version, integrity })).sort((left, right) => left.package.localeCompare(right.package)));
      const targetDeploymentClosure = Object.freeze([...application.bundle.installedPackages].sort((left, right) => `${left.package}@${left.version}`.localeCompare(`${right.package}@${right.version}`)));
      const plan = Object.freeze({
        applicationId: inventory.applicationId,
        repository: inventory.repository,
        environment: inventory.environment,
        package: packageName,
        currentVersion: current.version,
        targetVersion,
        targetIntegrity: target.integrity,
        targetRelease: targetRelease.release.version,
        targetReleaseManifestDigest: verifiedTarget.digest,
        targetFrameworkDigest: application.bundle.frameworkDigest,
        targetMigrationPlanDigest: application.bundle.migrationPlanDigest,
        targetMigrationRevision: application.bundle.targetMigrationRevision,
        targetClosure,
        targetDeploymentClosure,
        baseInventoryDigest: runtimeInventoryDigest(inventory),
        operations: Object.freeze(["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"] as const)
      });
      this.#patchPlans.add(plan);
      return plan;
    });
    return Object.freeze(plans);
  }

  applySecurityPatch(plan: SecurityPatchPlan, evidence: VerifiedDeploymentEvidence): FleetDeployment {
    if (!this.#patchPlans.has(plan)) throw new FleetEvidenceError("PATCH_INVALID", "Security patch plan was not issued by this fleet authority.");
    this.#patchPlans.delete(plan);
    const key = `${plan.applicationId}\u0000${plan.environment}`;
    const current = this.#deployments.get(key);
    if (current === undefined || runtimeInventoryDigest(current.inventory) !== plan.baseInventoryDigest) throw new FleetEvidenceError("CONFLICT", "Security patch base inventory changed before application.");
    let target: Readonly<{ receipt: DeploymentReceipt; inventory: RuntimeInventory }>;
    try { target = this.#authority.read(evidence); } catch { throw new FleetEvidenceError("EVIDENCE_INVALID", "Security patch result requires verified deployment evidence."); }
    const closure = [...target.inventory.packages].sort((left, right) => left.package.localeCompare(right.package));
    if (target.inventory.applicationId !== plan.applicationId || target.inventory.environment !== plan.environment ||
      target.inventory.platformRelease !== plan.targetRelease || canonicalJson(closure) !== canonicalJson(plan.targetDeploymentClosure) ||
      target.inventory.releaseEvidence.frameworkDigest !== plan.targetFrameworkDigest ||
      target.inventory.releaseEvidence.resolvedGraphDigest !== plan.targetMigrationPlanDigest ||
      target.inventory.health.status !== "ready" || target.inventory.migrationRevision !== plan.targetMigrationRevision ||
      plan.targetMigrationRevision <= current.inventory.migrationRevision) {
      throw new FleetEvidenceError("PATCH_INVALID", "Security patch result does not match the complete verified target release transition.");
    }
    this.#supportedReleases.add(plan.targetRelease);
    this.ingest(evidence);
    return this.#deployments.get(key)!;
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
