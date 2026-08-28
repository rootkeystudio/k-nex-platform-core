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

interface GitHubVerificationEntry {
  readonly attestation?: { readonly bundle?: { readonly dsseEnvelope?: { readonly payload?: string } } };
  readonly verificationResult?: {
    readonly signature?: { readonly certificate?: Record<string, unknown> };
    readonly statement?: unknown;
  };
}

export function createGitHubHostedAttestationVerifier(input: {
  readonly repository: string;
  readonly workflow: string;
  readonly predicateType: string;
}): HostedAttestationVerifier {
  return Object.freeze({
    async verify(value: unknown): Promise<VerifiedHostedAttestation> {
      const entry = value as GitHubVerificationEntry;
      const payload = entry?.attestation?.bundle?.dsseEnvelope?.payload;
      const statement = entry?.verificationResult?.statement as Record<string, unknown> | undefined;
      const certificate = entry?.verificationResult?.signature?.certificate;
      if (typeof payload !== "string" || statement === undefined || certificate === undefined) throw new Error("GitHub hosted attestation verification output is incomplete.");
      let signedStatement: unknown;
      try { signedStatement = JSON.parse(Buffer.from(payload, "base64").toString("utf8")); } catch { throw new Error("GitHub hosted attestation contains an invalid signed statement."); }
      if (canonicalJson(signedStatement) !== canonicalJson(statement)) throw new Error("GitHub verification result differs from the signed DSSE statement.");
      const sourceCommit = certificate.sourceRepositoryDigest;
      const workflowIdentity = `${input.repository}/.github/workflows/${input.workflow}@${sourceCommit}`;
      const predicate = statement.predicate as Record<string, unknown> | undefined;
      const subjects = statement.subject as readonly { readonly digest?: { readonly sha256?: string } }[] | undefined;
      const materials = (predicate?.materials ?? []) as readonly { readonly name?: string; readonly digest?: string }[];
      if (statement._type !== "https://in-toto.io/Statement/v1" || statement.predicateType !== input.predicateType ||
        certificate.githubWorkflowRepository !== input.repository || certificate.runnerEnvironment !== "github-hosted" ||
        certificate.buildConfigURI !== `https://github.com/${input.repository}/.github/workflows/${input.workflow}@${certificate.githubWorkflowRef}` ||
        certificate.githubWorkflowSHA !== sourceCommit || certificate.buildConfigDigest !== sourceCommit ||
        typeof sourceCommit !== "string" || !/^[0-9a-f]{40}$/u.test(sourceCommit) ||
        predicate?.sourceCommit !== sourceCommit || predicate?.workflowIdentity !== workflowIdentity ||
        subjects?.length !== 1 || !/^[0-9a-f]{64}$/u.test(subjects[0]?.digest?.sha256 ?? "") || !Array.isArray(materials) ||
        materials.some((material) => typeof material.name !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(material.digest ?? ""))) {
        throw new Error("GitHub hosted attestation identity or signed predicate is not trusted.");
      }
      return freeze({
        subjectDigest: `sha256:${subjects[0]!.digest!.sha256!}`,
        sourceCommit,
        workflowIdentity,
        materials: materials.map(({ name, digest }) => ({ name: name!, digest: digest! }))
      });
    }
  });
}

declare const verifiedPackageReleaseManifest: unique symbol;
export interface VerifiedPackageReleaseManifest {
  readonly [verifiedPackageReleaseManifest]: true;
}

export interface PackageReleaseManifestAuthority {
  verify(manifest: PackageReleaseManifest, attestation: unknown): Promise<VerifiedPackageReleaseManifest>;
  read(token: VerifiedPackageReleaseManifest): Readonly<{ manifest: PackageReleaseManifest; digest: string; attestation: VerifiedHostedAttestation }>;
}

export interface ApplicationBundle {
  readonly schemaVersion: 1;
  readonly format: "k-nex-deployable-application-bundle/v1";
  readonly applicationId: string;
  readonly sourceCommit: string;
  readonly release: string;
  readonly releaseManifestDigest: string;
  readonly closureDigest: string;
  readonly frameworkDigest: string;
  readonly migrationPlanDigest: string;
  readonly targetMigrationRevision: number;
  readonly installedPackages: readonly { readonly package: string; readonly version: string; readonly integrity: string }[];
  readonly files: readonly { readonly path: string; readonly mode: number; readonly digest: string; readonly content: string }[];
}

declare const verifiedApplicationBundle: unique symbol;
export interface VerifiedApplicationBundle { readonly [verifiedApplicationBundle]: true; }

export interface ApplicationBundleAuthority {
  verify(bundle: ApplicationBundle, attestation: unknown, release: VerifiedPackageReleaseManifest): Promise<VerifiedApplicationBundle>;
  read(token: VerifiedApplicationBundle): Readonly<{ bundle: ApplicationBundle; digest: string; attestation: VerifiedHostedAttestation }>;
}

export function createApplicationBundleAuthority(verifier: HostedAttestationVerifier, releases: PackageReleaseManifestAuthority): ApplicationBundleAuthority {
  const tokens = new WeakMap<object, Readonly<{ bundle: ApplicationBundle; digest: string; attestation: VerifiedHostedAttestation }>>();
  const authority: ApplicationBundleAuthority = {
    async verify(value, attestationInput, releaseToken) {
      const bundle = structuredClone(value);
      const release = releases.read(releaseToken);
      const digest = `sha256:${createHash("sha256").update(canonicalJson(bundle)).digest("hex")}`;
      const attestation = await verifier.verify(attestationInput);
      const installed = [...bundle.installedPackages].sort((left, right) => left.package.localeCompare(right.package));
      const releasePackages = new Map(release.manifest.packages.map((entry) => [entry.package, entry]));
      const releaseFrameworkDigest = `sha256:${createHash("sha256").update(canonicalJson(release.manifest.framework)).digest("hex")}`;
      const packageMatchesRelease = (entry: ApplicationBundle["installedPackages"][number]): boolean => {
        const found = releasePackages.get(entry.package);
        return found !== undefined && found.version === entry.version && found.integrity === entry.integrity;
      };
      if (bundle.schemaVersion !== 1 || bundle.format !== "k-nex-deployable-application-bundle/v1" || bundle.release !== release.manifest.release.version ||
        bundle.releaseManifestDigest !== release.digest || bundle.sourceCommit !== attestation.sourceCommit || attestation.subjectDigest !== digest ||
        bundle.closureDigest !== `sha256:${createHash("sha256").update(canonicalJson(installed)).digest("hex")}` || bundle.targetMigrationRevision < 0 ||
        bundle.frameworkDigest !== releaseFrameworkDigest || !/^sha256:[0-9a-f]{64}$/u.test(bundle.migrationPlanDigest) ||
        installed.length === 0 || new Set(installed.map((entry) => entry.package)).size !== installed.length ||
        installed.some((entry) => !entry.package.startsWith("@k-nex/") || !packageMatchesRelease(entry))) {
        throw new Error("Hosted attestation does not bind a valid deployable application bundle.");
      }
      const token = Object.freeze({}) as VerifiedApplicationBundle;
      tokens.set(token, freeze({ bundle, digest, attestation: structuredClone(attestation) }));
      return token;
    },
    read(token) {
      const value = tokens.get(token);
      if (value === undefined) throw new Error("Application bundle was not issued by this hosted-attestation authority.");
      return value;
    }
  };
  return Object.freeze(authority);
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
    readonly applicationBundle: VerifiedApplicationBundle;
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
  readonly applicationBundleAuthority: ApplicationBundleAuthority;
  readonly packageReleaseAuthority: PackageReleaseManifestAuthority;
  readonly deploymentPublicKey: string;
  readonly trustedDeploymentWorkflow: string;
}): DeploymentEvidenceAuthority {
  const evidence = new WeakMap<object, Readonly<{ receipt: DeploymentReceipt; inventory: RuntimeInventory }>>();
  const authority: DeploymentEvidenceAuthority = {
    async verify(candidate) {
      const inventory = observeRuntimeInventory(RuntimeInventorySchema.parse(await candidate.observe()));
      const receipt = verifyDeploymentReceipt(candidate.receipt, input.deploymentPublicKey);
      const application = input.applicationBundleAuthority.read(candidate.applicationBundle);
      const releaseAttestation = application.attestation;
      const packageRelease = input.packageReleaseAuthority.read(candidate.packageRelease);
      if (releaseAttestation.workflowIdentity !== inventory.releaseEvidence.workflowIdentity ||
        receipt.approvedBy.kind !== "workflow" || receipt.approvedBy.identity !== input.trustedDeploymentWorkflow) throw new Error("Deployment evidence workflow identity is not trusted.");
      const material = new Map(releaseAttestation.materials.map((entry) => [entry.name, entry.digest]));
      const releasedPackages = [...application.bundle.installedPackages].sort((left, right) => left.package.localeCompare(right.package));
      const observedPackages = inventory.packages.filter((entry) => entry.package.startsWith("@k-nex/")).sort((left, right) => left.package.localeCompare(right.package));
      if (releaseAttestation.subjectDigest !== inventory.artifactDigest || releaseAttestation.sourceCommit !== inventory.releaseEvidence.sourceCommit ||
        packageRelease.attestation.workflowIdentity !== releaseAttestation.workflowIdentity || packageRelease.attestation.sourceCommit !== releaseAttestation.sourceCommit ||
        packageRelease.manifest.release.version !== inventory.platformRelease || application.bundle.applicationId !== inventory.applicationId ||
        application.bundle.frameworkDigest !== inventory.releaseEvidence.frameworkDigest || application.bundle.migrationPlanDigest !== inventory.releaseEvidence.resolvedGraphDigest ||
        application.bundle.targetMigrationRevision !== inventory.migrationRevision || canonicalJson(observedPackages) !== canonicalJson(releasedPackages) ||
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
