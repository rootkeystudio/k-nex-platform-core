import { createHash, sign, verify } from "node:crypto";

import { DeploymentReceiptSchema, PackageReleaseManifestSchema, RuntimeInventorySchema, canonicalJson, type DeploymentReceipt, type PackageReleaseManifest, type RuntimeInventory } from "@k-nex/contracts";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export interface SignedDeploymentReceipt {
  readonly algorithm: "Ed25519";
  readonly payloadType: "application/vnd.k-nex.deployment-receipt+json";
  readonly payload: string;
  readonly signature: string;
}

declare const verifiedDeploymentEvidence: unique symbol;
export interface VerifiedDeploymentEvidence {
  readonly [verifiedDeploymentEvidence]: true;
}

export interface VerifiedHostedAttestation {
  readonly subjectDigest: string;
  readonly sourceCommit: string;
  readonly workflowIdentity: string;
  readonly materials: readonly { readonly name: string; readonly digest: string }[];
}

export interface HostedAttestationVerifier {
  verify(attestation: unknown): Promise<VerifiedHostedAttestation>;
}

declare const verifiedPackageReleaseManifest: unique symbol;
export interface VerifiedPackageReleaseManifest {
  readonly [verifiedPackageReleaseManifest]: true;
}

export interface PackageReleaseManifestAuthority {
  verify(manifest: PackageReleaseManifest, attestation: unknown): Promise<VerifiedPackageReleaseManifest>;
  read(token: VerifiedPackageReleaseManifest): Readonly<{ manifest: PackageReleaseManifest; digest: string; attestation: VerifiedHostedAttestation }>;
}

export function createPackageReleaseManifestAuthority(verifier: HostedAttestationVerifier): PackageReleaseManifestAuthority {
  const tokens = new WeakMap<object, Readonly<{ manifest: PackageReleaseManifest; digest: string; attestation: VerifiedHostedAttestation }>>();
  const authority: PackageReleaseManifestAuthority = {
    async verify(value, attestationInput) {
      const manifest = PackageReleaseManifestSchema.parse(value);
      const digest = `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`;
      const attestation = await verifier.verify(attestationInput);
      if (attestation.subjectDigest !== digest) throw new Error("Hosted attestation does not bind the package release manifest.");
      const token = Object.freeze({}) as VerifiedPackageReleaseManifest;
      tokens.set(token, freeze({ manifest: structuredClone(manifest), digest, attestation: structuredClone(attestation) }));
      return token;
    },
    read(token) {
      const value = tokens.get(token);
      if (value === undefined) throw new Error("Package release manifest was not issued by this hosted-attestation authority.");
      return value;
    }
  };
  return Object.freeze(authority);
}

export interface DeploymentEvidenceAuthority {
  verify(input: {
    readonly observe: () => Promise<unknown>;
    readonly receipt: SignedDeploymentReceipt;
    readonly releaseAttestation: unknown;
    readonly packageRelease: VerifiedPackageReleaseManifest;
  }): Promise<VerifiedDeploymentEvidence>;
  read(evidence: VerifiedDeploymentEvidence): Readonly<{ receipt: DeploymentReceipt; inventory: RuntimeInventory }>;
}

export function signDeploymentReceipt(receipt: DeploymentReceipt, privateKey: string): SignedDeploymentReceipt {
  const payload = canonicalJson(DeploymentReceiptSchema.parse(receipt));
  return freeze({
    algorithm: "Ed25519" as const,
    payloadType: "application/vnd.k-nex.deployment-receipt+json" as const,
    payload,
    signature: sign(null, Buffer.from(payload), privateKey).toString("base64")
  });
}

function verifyDeploymentReceipt(envelope: SignedDeploymentReceipt, publicKey: string): DeploymentReceipt {
  if (envelope.algorithm !== "Ed25519" || envelope.payloadType !== "application/vnd.k-nex.deployment-receipt+json" ||
    !verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, "base64"))) throw new Error("Deployment receipt signature is invalid.");
  const receipt = DeploymentReceiptSchema.parse(JSON.parse(envelope.payload));
  if (canonicalJson(receipt) !== envelope.payload) throw new Error("Deployment receipt payload is non-canonical.");
  return receipt;
}

export function createDeploymentEvidenceAuthority(input: {
  readonly releaseVerifier: HostedAttestationVerifier;
  readonly packageReleaseAuthority: PackageReleaseManifestAuthority;
  readonly deploymentPublicKey: string;
  readonly trustedDeploymentWorkflow: string;
}): DeploymentEvidenceAuthority {
  const evidence = new WeakMap<object, Readonly<{ receipt: DeploymentReceipt; inventory: RuntimeInventory }>>();
  const authority: DeploymentEvidenceAuthority = {
    async verify(candidate) {
      const inventory = observeRuntimeInventory(RuntimeInventorySchema.parse(await candidate.observe()));
      const receipt = verifyDeploymentReceipt(candidate.receipt, input.deploymentPublicKey);
      const releaseAttestation = await input.releaseVerifier.verify(candidate.releaseAttestation);
      const packageRelease = input.packageReleaseAuthority.read(candidate.packageRelease);
      if (releaseAttestation.workflowIdentity !== inventory.releaseEvidence.workflowIdentity ||
        receipt.approvedBy.kind !== "workflow" || receipt.approvedBy.identity !== input.trustedDeploymentWorkflow) throw new Error("Deployment evidence workflow identity is not trusted.");
      const material = new Map(releaseAttestation.materials.map((entry) => [entry.name, entry.digest]));
      const releasedPackages = [...packageRelease.manifest.packages].map(({ package: packageName, version, integrity }) => ({ package: packageName, version, integrity })).sort((left, right) => left.package.localeCompare(right.package));
      const observedPackages = [...inventory.packages].sort((left, right) => left.package.localeCompare(right.package));
      if (releaseAttestation.subjectDigest !== inventory.artifactDigest || releaseAttestation.sourceCommit !== inventory.releaseEvidence.sourceCommit ||
        packageRelease.attestation.workflowIdentity !== releaseAttestation.workflowIdentity || packageRelease.attestation.sourceCommit !== releaseAttestation.sourceCommit ||
        packageRelease.manifest.release.version !== inventory.platformRelease || canonicalJson(releasedPackages) !== canonicalJson(observedPackages) ||
        runtimeInventoryDigest(inventory) !== receipt.inventoryDigest || !reconcileDeploymentReceipt(receipt, inventory) ||
        material.get("application-manifest") !== inventory.releaseEvidence.manifestDigest || material.get("lockfile") !== inventory.releaseEvidence.lockfileDigest ||
        material.get("resolved-graph-or-plan") !== inventory.releaseEvidence.resolvedGraphDigest || material.get("sbom") !== inventory.releaseEvidence.sbomDigest ||
        material.get("package-release-manifest") !== packageRelease.digest ||
        `sha256:${createHash("sha256").update(canonicalJson(releaseAttestation)).digest("hex")}` !== inventory.releaseEvidence.provenanceDigest) {
        throw new Error("Signed deployment evidence does not reconcile to the observed runtime inventory.");
      }
      const token = Object.freeze({}) as VerifiedDeploymentEvidence;
      evidence.set(token, freeze({ receipt: structuredClone(receipt), inventory: structuredClone(inventory) }));
      return token;
    },
    read(token) {
      const deployment = evidence.get(token);
      if (deployment === undefined) throw new Error("Deployment evidence was not issued by this trusted authority.");
      return deployment;
    }
  };
  return Object.freeze(authority);
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
