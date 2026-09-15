import { createHash } from "node:crypto";

import {
  ApplicationReleaseLockSchema,
  ApplicationUpgradePlanEnvelopeV1Schema,
  GeneratedFileOwnershipManifestSchema,
  PackageReleaseManifestSchema,
  PlatformReleaseTransitionManifestSchema,
  PreparationResultV1Schema,
  applicationUpgradePlanDigestInput,
  canonicalApplicationReleaseLock,
  canonicalGeneratedFileOwnershipManifest,
  canonicalJson,
  platformReleaseGeneratorContractDigest,
  preparationResultDigestInput,
  type ApplicationReleaseLock,
  type ApplicationUpgradePlanEnvelopeV1,
  type GeneratedFileOwnershipManifest,
  type PackageReleaseManifestAuthority,
  type PlatformReleaseTransitionManifestAuthority,
  type PreparationResultV1,
  type VerifiedPackageReleaseManifest,
  type VerifiedPlatformReleaseTransitionManifest
} from "@k-nex/contracts";

export type UpgradeRepositoryFile = Readonly<{ kind: "file"; bytes: Uint8Array }> | Readonly<{ kind: "symlink" }>;
export interface UpgradeInstalledInventory {
  readonly packages: ApplicationReleaseLock["packages"];
  readonly plugins: ApplicationReleaseLock["plugins"];
}
export interface TargetGeneratedApplication {
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly ownership: GeneratedFileOwnershipManifest;
  readonly releaseLock: ApplicationReleaseLock;
  readonly controlFiles: Readonly<Record<string, Uint8Array>>;
}
declare const verifiedTargetGeneratedApplication: unique symbol;
export interface VerifiedTargetGeneratedApplication { readonly [verifiedTargetGeneratedApplication]: true; }
export interface TargetGeneratedApplicationAuthority {
  read(token: VerifiedTargetGeneratedApplication): Readonly<{ generation: TargetGeneratedApplication; digest: string }>;
}
declare const verifiedSourceApplicationSnapshot: unique symbol;
export interface VerifiedSourceApplicationSnapshot { readonly [verifiedSourceApplicationSnapshot]: true; }
export interface SourceApplicationSnapshotBinding {
  readonly applicationId: string;
  readonly sourceCommit: string;
  readonly applicationManifestSchemaVersion: number;
  readonly sourceReleaseLockDigest: string;
  readonly packageAndLockClosureDigest: string;
  readonly applicationManifestPluginGraphDigest: string;
}
/** Issuers parse canonical app/package/lock controls and bind their selected graph to these facts. */
export interface SourceApplicationSnapshotAuthority {
  read(token: VerifiedSourceApplicationSnapshot): Readonly<{ files: Readonly<Record<string, UpgradeRepositoryFile>>; digest: string; binding: SourceApplicationSnapshotBinding }>;
}
export interface CompileApplicationUpgradeInput {
  readonly expectedSourceCommit: string;
  readonly actualSourceCommit: string;
  readonly sourceSnapshotAuthority: SourceApplicationSnapshotAuthority;
  readonly sourceSnapshotToken: VerifiedSourceApplicationSnapshot;
  readonly currentFilesDigest: string;
  readonly sourceReleaseLock: ApplicationReleaseLock;
  readonly sourceReleaseLockDigest: string;
  readonly sourceOwnership: GeneratedFileOwnershipManifest;
  readonly sourceOwnershipDigest: string;
  readonly installedInventory: UpgradeInstalledInventory;
  readonly installedInventoryDigest: string;
  readonly transitionAuthority: PlatformReleaseTransitionManifestAuthority;
  readonly transitionToken: VerifiedPlatformReleaseTransitionManifest;
  readonly transitionManifestDigest: string;
  readonly targetReleaseAuthority: PackageReleaseManifestAuthority;
  readonly targetReleaseToken: VerifiedPackageReleaseManifest;
  readonly targetReleaseManifestDigest: string;
  readonly evaluatedAt: string;
  readonly targetGenerationAuthority: TargetGeneratedApplicationAuthority;
  readonly targetGenerationToken: VerifiedTargetGeneratedApplication;
  readonly targetGenerationDigest: string;
  readonly expectedInputSnapshotDigest?: string;
}

interface PrivateUpgradeReconciliationEvidence {
  readonly sourceTreeDigest: string;
  readonly sourceReleaseLockDigest: string;
  readonly sourceOwnershipDigest: string;
  readonly installedInventoryDigest: string;
  readonly targetReleaseManifestDigest: string;
  readonly targetGenerationDigest: string;
  readonly preparedTreeDigest?: string;
}

export type ApplicationUpgradeCompilation =
  | Readonly<{ outcome: "blocked"; plan: ApplicationUpgradePlanEnvelopeV1; evidence: PrivateUpgradeReconciliationEvidence }>
  | Readonly<{ outcome: "prepared"; plan: ApplicationUpgradePlanEnvelopeV1; evidence: PrivateUpgradeReconciliationEvidence; preparedFiles: Readonly<Record<string, Uint8Array>> }>;

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const requiredControlPaths = [".k-nex/generated-files.json", ".k-nex/release-lock.json", "k-nex.app.json", "package.json", "pnpm-lock.yaml"] as const;
const digestBytes = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const digestValue = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const compareCodeUnits = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const integrityBytes = (bytes: Uint8Array) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const archivePath = (packageName: string, version: string) => `.k-nex/packages/${packageName.replace(/^@/u, "").replaceAll("/", "-")}-${version}.tgz`;

function safePath(path: string): boolean {
  return path.length > 0 && path.length <= 512 && !path.startsWith("/") && !path.startsWith("\\") && !/^[A-Za-z]:[\\/]/u.test(path) && !path.includes("\\") && !/[\u0000-\u001f\u007f-\u009f]/u.test(path) && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function controlPath(path: string): boolean { return requiredControlPaths.includes(path as typeof requiredControlPaths[number]) || path.startsWith(".k-nex/packages/") || path.startsWith(".k-nex/upgrades/"); }

function snapshotProjection(files: Readonly<Record<string, UpgradeRepositoryFile>>) {
  return Object.keys(files).sort(compareCodeUnits).map((path) => {
    if (!safePath(path)) throw new TypeError(`Repository snapshot contains unsafe path: ${path}.`);
    const file = files[path]!;
    if (file.kind === "symlink") throw new TypeError(`Repository snapshot contains forbidden symlink: ${path}.`);
    return { path, digest: digestBytes(file.bytes) };
  });
}

function generatedProjection(target: TargetGeneratedApplication) {
  const files = Object.keys(target.files).sort(compareCodeUnits).map((path) => ({ path, digest: digestBytes(target.files[path]!) }));
  const controls = Object.keys(target.controlFiles).sort(compareCodeUnits).map((path) => ({ path, digest: digestBytes(target.controlFiles[path]!) }));
  return { files, controls, ownership: target.ownership, releaseLock: target.releaseLock };
}

function assertDigest(actual: string, expected: string, label: string): void {
  if (!digestPattern.test(expected) || actual !== expected) throw new TypeError(`${label} is stale or invalid.`);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function exactPackageProjection(lock: ApplicationReleaseLock) {
  return { packages: lock.packages, plugins: lock.plugins };
}

function validateTargetReleaseLock(lock: ApplicationReleaseLock, ownershipDigest: string, transitionDigest: string, transition: ReturnType<typeof PlatformReleaseTransitionManifestSchema.parse>, targetRelease: ReturnType<typeof PackageReleaseManifestSchema.parse>): void {
  if (lock.platformRelease !== transition.target.release || lock.releaseManifestDigest !== transition.target.manifestDigest || lock.sourceOwnershipDigest !== ownershipDigest) throw new TypeError("Target release lock does not bind the target transition and ownership manifest.");
  if (lock.generator.package !== transition.generator.package || lock.generator.version !== transition.generator.targetVersion || lock.generator.schemaVersion !== transition.generator.targetSchemaVersion) throw new TypeError("Target release lock generator does not bind the transition.");
  const released = new Map(targetRelease.packages.map((entry) => [entry.package, entry]));
  for (const entry of lock.packages) {
    const target = released.get(entry.package);
    if (target === undefined || target.version !== entry.version || target.role !== entry.role || target.integrity !== entry.integrity) throw new TypeError(`Target release lock package is outside the verified release closure: ${entry.package}.`);
  }
  if (lock.frameworkTupleDigest !== digestValue(targetRelease.framework) || lock.migrationSetDigest !== transition.migrations.graphDigest) throw new TypeError("Target release lock framework or migration set is stale.");
  const lineage = lock.transitionChain.at(-1);
  if (lineage === undefined || lineage.transitionId !== transition.transitionId || lineage.sourceRelease !== transition.source.release || lineage.targetRelease !== transition.target.release || lineage.manifestDigest !== transitionDigest) throw new TypeError("Target release lock transition lineage is missing or ambiguous.");
}

export function compileApplicationUpgrade(input: CompileApplicationUpgradeInput): ApplicationUpgradeCompilation {
  if (!commitPattern.test(input.actualSourceCommit) || input.actualSourceCommit !== input.expectedSourceCommit) throw new TypeError("Source commit is stale or invalid.");
  let sourceSnapshotRecord: ReturnType<SourceApplicationSnapshotAuthority["read"]>;
  try { sourceSnapshotRecord = input.sourceSnapshotAuthority.read(input.sourceSnapshotToken); } catch { throw new TypeError("Upgrade requires an authority-verified source application snapshot."); }
  const currentFiles = sourceSnapshotRecord.files;
  const sourceLock = ApplicationReleaseLockSchema.parse(input.sourceReleaseLock);
  const sourceOwnership = GeneratedFileOwnershipManifestSchema.parse(input.sourceOwnership);
  let transitionRecord: ReturnType<PlatformReleaseTransitionManifestAuthority["read"]>;
  let targetReleaseRecord: ReturnType<PackageReleaseManifestAuthority["read"]>;
  try { transitionRecord = input.transitionAuthority.read(input.transitionToken); } catch { throw new TypeError("Upgrade requires an authority-verified transition manifest."); }
  try { targetReleaseRecord = input.targetReleaseAuthority.read(input.targetReleaseToken); } catch { throw new TypeError("Upgrade requires an authority-verified target release manifest."); }
  const transition = PlatformReleaseTransitionManifestSchema.parse(transitionRecord.manifest);
  const targetRelease = PackageReleaseManifestSchema.parse(targetReleaseRecord.manifest);
  let targetGenerationRecord: ReturnType<TargetGeneratedApplicationAuthority["read"]>;
  try { targetGenerationRecord = input.targetGenerationAuthority.read(input.targetGenerationToken); } catch { throw new TypeError("Upgrade requires an authority-verified target generation."); }
  const targetGeneration = targetGenerationRecord.generation;
  const targetOwnership = GeneratedFileOwnershipManifestSchema.parse(targetGeneration.ownership);
  const targetLock = ApplicationReleaseLockSchema.parse(targetGeneration.releaseLock);
  if (sourceLock.applicationId !== sourceOwnership.applicationId || sourceLock.applicationId !== targetOwnership.applicationId || sourceLock.applicationId !== targetLock.applicationId) throw new TypeError("Application identity changed across upgrade inputs.");

  const sourceLockDigest = digestValue(sourceLock);
  const sourceOwnershipDigest = digestValue(sourceOwnership);
  const inventoryDigest = digestValue(input.installedInventory);
  const transitionDigest = digestValue(transition);
  const targetReleaseDigest = digestValue(targetRelease);
  if (transitionRecord.digest !== transitionDigest || targetReleaseRecord.digest !== targetReleaseDigest) throw new TypeError("Verified manifest authority returned a stale digest binding.");
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAt) || evaluatedAt < Date.parse(transition.lifecycle.publishedAt) || evaluatedAt >= Date.parse(transition.lifecycle.expiresAt) || transition.lifecycle.support !== "supported" || transition.lifecycle.revocation.status !== "active") throw new TypeError("Transition is not current and active at evaluation time.");
  const sourceTreeProjection = snapshotProjection(currentFiles);
  const sourceTreeDigest = digestValue(sourceTreeProjection);
  if (sourceSnapshotRecord.digest !== sourceTreeDigest) throw new TypeError("Verified source-snapshot authority returned a stale digest binding.");
  const targetGenerationDigest = digestValue(generatedProjection(targetGeneration));
  if (targetGenerationRecord.digest !== targetGenerationDigest) throw new TypeError("Verified target-generation authority returned a stale digest binding.");
  assertDigest(sourceLockDigest, input.sourceReleaseLockDigest, "Source release-lock digest");
  assertDigest(sourceOwnershipDigest, input.sourceOwnershipDigest, "Source ownership digest");
  assertDigest(inventoryDigest, input.installedInventoryDigest, "Installed inventory digest");
  assertDigest(transitionDigest, input.transitionManifestDigest, "Transition manifest digest");
  assertDigest(targetReleaseDigest, input.targetReleaseManifestDigest, "Target release-manifest digest");
  assertDigest(sourceTreeDigest, input.currentFilesDigest, "Source repository snapshot digest");
  assertDigest(targetGenerationDigest, input.targetGenerationDigest, "Target generation digest");
  if (sourceLock.sourceOwnershipDigest !== sourceOwnershipDigest || sourceLock.platformRelease !== transition.source.release || sourceLock.releaseManifestDigest !== transition.source.manifestDigest || targetRelease.release.version !== transition.target.release || targetReleaseDigest !== transition.target.manifestDigest) throw new TypeError("Release lock, transition, or target release identity is stale.");
  const expectedSourceBinding: SourceApplicationSnapshotBinding = {
    applicationId: sourceLock.applicationId,
    sourceCommit: input.actualSourceCommit,
    applicationManifestSchemaVersion: transition.applicationManifest.sourceSchemaVersion,
    sourceReleaseLockDigest: sourceLockDigest,
    packageAndLockClosureDigest: digestValue(sourceLock.packages),
    applicationManifestPluginGraphDigest: digestValue(sourceLock.plugins)
  };
  if (canonicalJson(sourceSnapshotRecord.binding) !== canonicalJson(expectedSourceBinding)) throw new TypeError("Source application controls do not bind the exact application manifest, package closure, plugin graph, and release lock.");
  if (sourceLock.generator.package !== transition.generator.package || sourceLock.generator.version !== transition.generator.sourceVersion || sourceLock.generator.schemaVersion !== transition.generator.sourceSchemaVersion) throw new TypeError("Source generator does not bind the transition.");
  if (sourceLock.generator.generatorId !== targetLock.generator.generatorId) throw new TypeError("Generator identity changed without a signed transition mapping.");
  if (sourceLock.frameworkTupleDigest !== digestValue(transition.framework.source)) throw new TypeError("Source release-lock framework tuple is stale.");
  if (canonicalJson(exactPackageProjection(sourceLock)) !== canonicalJson(input.installedInventory)) throw new TypeError("Installed inventory differs from the source release lock.");

  const sourceLockFile = currentFiles[".k-nex/release-lock.json"];
  const sourceOwnershipFile = currentFiles[".k-nex/generated-files.json"];
  if (sourceLockFile?.kind !== "file" || new TextDecoder().decode(sourceLockFile.bytes) !== canonicalApplicationReleaseLock(sourceLock) || sourceOwnershipFile?.kind !== "file" || new TextDecoder().decode(sourceOwnershipFile.bytes) !== canonicalGeneratedFileOwnershipManifest(sourceOwnership)) throw new TypeError("Source control files differ from their exact parsed inputs.");
  const expectedControls = new Set<string>(requiredControlPaths);
  for (const entry of targetLock.packages) expectedControls.add(archivePath(entry.package, entry.version));
  for (const path of expectedControls) if (targetGeneration.controlFiles[path] === undefined) throw new TypeError(`Target generation omits required release-control file: ${path}.`);
  for (const path of Object.keys(targetGeneration.controlFiles)) if (!safePath(path) || !expectedControls.has(path)) throw new TypeError(`Target generation contains unauthorized release-control path: ${path}.`);
  for (const path of Object.keys(targetGeneration.files)) if (!safePath(path) || controlPath(path)) throw new TypeError(`Target generated ownership path is invalid or release-controlled: ${path}.`);

  const targetOwnershipDigest = digestValue(targetOwnership);
  const sourceGeneratorPackage = sourceLock.packages.find((entry) => entry.package === transition.generator.package);
  const targetGeneratorPackage = targetLock.packages.find((entry) => entry.package === transition.generator.package);
  if (sourceGeneratorPackage === undefined || targetGeneratorPackage === undefined || transition.generator.managedOutputContractDigest !== platformReleaseGeneratorContractDigest(sourceGeneratorPackage, targetGeneratorPackage)) throw new TypeError("Global generator managed-output contract digest is stale.");
  validateTargetReleaseLock(targetLock, targetOwnershipDigest, transitionDigest, transition, targetRelease);
  const expectedTransitionChain = [...sourceLock.transitionChain, { transitionId: transition.transitionId, sourceRelease: transition.source.release, targetRelease: transition.target.release, manifestDigest: transitionDigest }];
  if (canonicalJson(targetLock.transitionChain) !== canonicalJson(expectedTransitionChain)) throw new TypeError("Target release-lock transition lineage does not exactly extend the source lineage.");
  for (const entry of targetLock.packages) {
    const bytes = targetGeneration.controlFiles[archivePath(entry.package, entry.version)]!;
    if (integrityBytes(bytes) !== entry.integrity) throw new TypeError(`Target package archive is tampered: ${entry.package}.`);
  }
  const mappings = new Map(transition.packages.map((mapping) => [mapping.identity.package, mapping]));
  const targetPackages = new Map(targetLock.packages.map((entry) => [entry.package, entry]));
  for (const sourcePackage of sourceLock.packages) {
    const mapping = mappings.get(sourcePackage.package);
    const targetPackage = targetPackages.get(sourcePackage.package);
    if (mapping?.disposition !== "upgrade" || mapping.source.version !== sourcePackage.version || mapping.source.integrity !== sourcePackage.integrity || targetPackage === undefined || mapping.target.version !== targetPackage.version || mapping.target.integrity !== targetPackage.integrity || mapping.identity.role !== sourcePackage.role || targetPackage.role !== sourcePackage.role) throw new TypeError(`Selected package does not have one exact preserved target upgrade: ${sourcePackage.package}.`);
  }
  for (const targetPackage of targetLock.packages) {
    const mapping = mappings.get(targetPackage.package);
    if (mapping === undefined || !("target" in mapping) || mapping.target.version !== targetPackage.version || mapping.target.integrity !== targetPackage.integrity || (mapping.disposition === "add-for-generator" && sourceLock.packages.some(({ package: name }) => name === targetPackage.package))) throw new TypeError(`Target selected package is not authorized by the exact transition: ${targetPackage.package}.`);
  }
  if (canonicalJson(sourceLock.plugins.map(({ id, package: packageName }) => ({ id, package: packageName }))) !== canonicalJson(targetLock.plugins.map(({ id, package: packageName }) => ({ id, package: packageName })))) throw new TypeError("Selected Platform Plugin identities changed during upgrade.");
  if (new TextDecoder().decode(targetGeneration.controlFiles[".k-nex/release-lock.json"]!) !== canonicalApplicationReleaseLock(targetLock) || new TextDecoder().decode(targetGeneration.controlFiles[".k-nex/generated-files.json"]!) !== canonicalGeneratedFileOwnershipManifest(targetOwnership)) throw new TypeError("Target control bytes do not equal their canonical release lock and ownership manifest.");

  const sourceRecords = new Map(sourceOwnership.files.map((record) => [record.path, record]));
  const targetRecords = new Map(targetOwnership.files.map((record) => [record.path, record]));
  for (const record of sourceOwnership.files) {
    const producer = sourceLock.packages.find((entry) => entry.package === record.producer.package);
    if (producer === undefined || producer.version !== record.producer.version || record.producer.generatorId !== sourceLock.generator.generatorId) throw new TypeError(`Source ownership producer is outside the release lock or generator: ${record.path}.`);
  }
  for (const record of targetOwnership.files) {
    const bytes = targetGeneration.files[record.path];
    if (bytes === undefined || digestBytes(bytes) !== record.digest) throw new TypeError(`Target generated bytes do not match ownership: ${record.path}.`);
    const historical = sourceRecords.get(record.path);
    const retainedAppendOnly = record.mode === "append-only" && historical?.mode === "append-only" && historical.digest === record.digest && canonicalJson(historical.producer) === canonicalJson(record.producer);
    const producer = targetLock.packages.find((entry) => entry.package === record.producer.package);
    if (!retainedAppendOnly && (producer === undefined || producer.version !== record.producer.version || record.producer.generatorId !== targetLock.generator.generatorId)) throw new TypeError(`Target ownership producer is outside the release lock or generator: ${record.path}.`);
  }
  for (const path of Object.keys(targetGeneration.files)) if (!targetRecords.has(path)) throw new TypeError(`Target generation emitted an unowned path: ${path}.`);

  const operations: Array<{ path: string; kind: "add" | "replace" | "append" | "conflict" } | { path: string; kind: "blocked"; reason: "managed-delete-reference-proof-required" }> = [];
  for (const source of sourceOwnership.files) {
    const current = currentFiles[source.path];
    if (current !== undefined && current.kind !== "file") throw new TypeError(`Owned source path is a symlink: ${source.path}.`);
    if (source.mode !== "template" && (current === undefined || digestBytes(current.bytes) !== source.digest)) operations.push({ path: source.path, kind: "conflict" });
    const target = targetRecords.get(source.path);
    if (source.mode === "managed" && target === undefined) operations.push({ path: source.path, kind: "blocked", reason: "managed-delete-reference-proof-required" });
    if (source.mode === "append-only" && (target === undefined || target.mode !== "append-only" || target.digest !== source.digest)) operations.push({ path: source.path, kind: "conflict" });
    if (target !== undefined && target.mode !== source.mode) operations.push({ path: source.path, kind: "conflict" });
  }
  for (const target of targetOwnership.files) {
    const source = sourceRecords.get(target.path);
    const current = currentFiles[target.path];
    const targetBytes = targetGeneration.files[target.path]!;
    if (source === undefined) {
      if (current !== undefined && target.mode !== "template") operations.push({ path: target.path, kind: "conflict" });
      else if (current === undefined) operations.push({ path: target.path, kind: target.mode === "append-only" ? "append" : "add" });
    } else if (source.mode === "managed" && current?.kind === "file" && digestBytes(current.bytes) === source.digest && !bytesEqual(current.bytes, targetBytes)) operations.push({ path: target.path, kind: "replace" });
    else if (source.mode === "template" && current === undefined) operations.push({ path: target.path, kind: "add" });
  }
  for (const [path, bytes] of Object.entries(targetGeneration.controlFiles)) {
    const current = currentFiles[path];
    if (current?.kind === "symlink") throw new TypeError(`Release-control path is a symlink: ${path}.`);
    if (current === undefined) operations.push({ path, kind: "add" });
    else if (!bytesEqual(current.bytes, bytes)) operations.push({ path, kind: "replace" });
  }
  const operationPriority = { add: 0, replace: 0, append: 0, conflict: 1, blocked: 2 } as const;
  const operationByPath = new Map<string, typeof operations[number]>();
  for (const operation of operations) {
    const current = operationByPath.get(operation.path);
    if (current === undefined || operationPriority[operation.kind] > operationPriority[current.kind]) operationByPath.set(operation.path, operation);
  }
  const normalizedOperations = [...operationByPath.values()].sort((left, right) => compareCodeUnits(left.path, right.path));

  const inputSnapshot = {
    applicationId: sourceLock.applicationId, sourceCommit: input.actualSourceCommit, sourceTreeDigest, sourceReleaseLockDigest: sourceLockDigest,
    sourceOwnershipDigest, installedInventoryDigest: inventoryDigest, transitionManifestDigest: transitionDigest, targetReleaseManifestDigest: targetReleaseDigest, targetGenerationDigest
  };
  const inputSnapshotDigest = digestValue(inputSnapshot);
  if (input.expectedInputSnapshotDigest !== undefined && input.expectedInputSnapshotDigest !== inputSnapshotDigest) throw new TypeError("Upgrade input snapshot is stale.");
  const planWithoutDigest = {
    schemaVersion: 1 as const,
    planId: `upgrade:${inputSnapshotDigest.slice(7)}`,
    inputSnapshotDigest,
    targetTransitionManifestDigest: transitionDigest,
    operations: normalizedOperations
  };
  const plan = ApplicationUpgradePlanEnvelopeV1Schema.parse({ ...planWithoutDigest, digest: digestValue(applicationUpgradePlanDigestInput(planWithoutDigest)) });
  const baseEvidence = { sourceTreeDigest, sourceReleaseLockDigest: sourceLockDigest, sourceOwnershipDigest, installedInventoryDigest: inventoryDigest, targetReleaseManifestDigest: targetReleaseDigest, targetGenerationDigest };
  if (normalizedOperations.some(({ kind }) => kind === "conflict" || kind === "blocked")) return Object.freeze({ outcome: "blocked", plan, evidence: Object.freeze(baseEvidence) });

  const preparedFiles: Record<string, Uint8Array> = Object.fromEntries(Object.entries(currentFiles).map(([path, file]) => [path, new Uint8Array((file as { kind: "file"; bytes: Uint8Array }).bytes)]));
  for (const target of targetOwnership.files) {
    const source = sourceRecords.get(target.path);
    const current = currentFiles[target.path];
    if (target.mode === "template" && current !== undefined) continue;
    if (target.mode === "append-only" && source !== undefined) continue;
    preparedFiles[target.path] = new Uint8Array(targetGeneration.files[target.path]!);
  }
  for (const [path, bytes] of Object.entries(targetGeneration.controlFiles)) preparedFiles[path] = new Uint8Array(bytes);
  const preparedTreeDigest = digestValue(snapshotProjection(Object.fromEntries(Object.entries(preparedFiles).map(([path, bytes]) => [path, { kind: "file", bytes }]))));
  return Object.freeze({ outcome: "prepared", plan, evidence: Object.freeze({ ...baseEvidence, preparedTreeDigest }), preparedFiles: Object.freeze(preparedFiles) });
}

export function createPreparationResultV1(input: Omit<PreparationResultV1, "schemaVersion" | "resultDigest">): PreparationResultV1 {
  if (!commitPattern.test(input.preparedSourceCommit)) throw new TypeError("Prepared source commit is invalid.");
  const withoutDigest = { schemaVersion: 1 as const, ...input };
  return PreparationResultV1Schema.parse({ ...withoutDigest, resultDigest: digestValue(preparationResultDigestInput(withoutDigest)) });
}

export const applicationUpgradeCompilerDigests = Object.freeze({
  value: digestValue,
  bytes: digestBytes,
  repository: (files: Readonly<Record<string, UpgradeRepositoryFile>>) => digestValue(snapshotProjection(files)),
  targetGeneration: (target: TargetGeneratedApplication) => digestValue(generatedProjection(target)),
  inventory: (inventory: UpgradeInstalledInventory) => digestValue(inventory)
});
