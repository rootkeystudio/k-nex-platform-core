import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalApplicationReleaseLock,
  canonicalGeneratedFileOwnershipManifest,
  canonicalJson,
  platformReleaseGeneratorContractDigest,
  type ApplicationReleaseLock,
  type GeneratedFileOwnershipManifest,
  type PackageReleaseManifestAuthority,
  type PlatformReleaseTransitionManifestAuthority,
  type VerifiedPackageReleaseManifest,
  type VerifiedPlatformReleaseTransitionManifest
} from "@k-nex/contracts";
import { applicationUpgradeCompilerDigests, compileApplicationUpgrade, createPreparationResultV1, type CompileApplicationUpgradeInput, type SourceApplicationSnapshotAuthority, type SourceApplicationSnapshotBinding, type TargetGeneratedApplication, type TargetGeneratedApplicationAuthority, type TargetGeneratedApplicationProvenance, type UpgradeRepositoryFile, type VerifiedSourceApplicationSnapshot, type VerifiedTargetGeneratedApplication } from "../src/application-upgrade-compiler.js";

const encode = (value: string) => new TextEncoder().encode(value);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const integrity = (character: string) => `sha512-${character.repeat(86)}==`;
const file = (value: string): UpgradeRepositoryFile => ({ kind: "file", bytes: encode(value) });
const sourceCommit = "a".repeat(40);
const sourceFramework = { core: "1.0.0", payload: "3.88.0", node: "24.19.0", pnpm: "11.9.0", payloadDatabaseAdapter: "postgres" } as const;
const targetFramework = { ...sourceFramework, core: "1.1.0" } as const;
const archiveBytes = encode("target runtime archive");
const targetIntegrity = `sha512-${createHash("sha512").update(archiveBytes).digest("base64")}`;
const applicationManifestBytes = (applicationId: string) => encode(canonicalJson({ schemaVersion: 1, application: { id: applicationId, name: applicationId, type: "customer-platform" }, runtime: { node: "24.19.0", packageManager: "pnpm", packageManagerVersion: "11.9.0", deploymentMode: "container" }, framework: { payload: { database: { adapter: "postgres", package: "@payloadcms/db-postgres", connectionEnvironmentVariable: "DATABASE_URL" } } }, plugins: [], providers: {}, themes: {}, development: { database: { mode: "external" } }, build: { dockerfile: true, commitGeneratedRegistries: true, validateGeneratedFilesInCI: true }, environment: { required: ["DATABASE_URL"] } }));
const packageJsonBytes = (version: string) => encode(`${JSON.stringify({ name: "customer-application", private: true, dependencies: { "@k-nex/runtime": version } }, null, 2)}\n`);
const pnpmLockBytes = (version: string) => encode(`lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@k-nex/runtime':\n        specifier: ${version}\n        version: ${version}\n`);

function authorized<T extends object, Token extends object>(manifest: T): { authority: { read(token: Token): { manifest: T; digest: string; attestation: object } }; token: Token } {
  const token = Object.freeze({}) as Token;
  const records = new WeakMap<object, { manifest: T; digest: string; attestation: object }>();
  records.set(token, Object.freeze({ manifest, digest: applicationUpgradeCompilerDigests.value(manifest), attestation: Object.freeze({ hosted: true }) }));
  return { token, authority: { read(candidate) { const record = records.get(candidate); if (record === undefined) throw new TypeError("unverified"); return record; } } };
}

function authorizedTarget(generation: TargetGeneratedApplication, provenance: TargetGeneratedApplicationProvenance): { authority: TargetGeneratedApplicationAuthority; token: VerifiedTargetGeneratedApplication } {
  const token = Object.freeze({}) as VerifiedTargetGeneratedApplication;
  const records = new WeakMap<object, { generation: TargetGeneratedApplication; digest: string; provenance: TargetGeneratedApplicationProvenance }>();
  records.set(token, Object.freeze({ generation, digest: applicationUpgradeCompilerDigests.targetGeneration(generation), provenance: Object.freeze(provenance) }));
  return { token, authority: { read(candidate) { const record = records.get(candidate); if (record === undefined) throw new TypeError("unverified"); return record; } } };
}

function authorizedSource(files: Readonly<Record<string, UpgradeRepositoryFile>>, binding: SourceApplicationSnapshotBinding): { authority: SourceApplicationSnapshotAuthority; token: VerifiedSourceApplicationSnapshot } {
  const token = Object.freeze({}) as VerifiedSourceApplicationSnapshot;
  const records = new WeakMap<object, { files: Readonly<Record<string, UpgradeRepositoryFile>>; digest: string; binding: SourceApplicationSnapshotBinding }>();
  records.set(token, Object.freeze({ files, digest: applicationUpgradeCompilerDigests.repository(files), binding: Object.freeze(binding) }));
  return { token, authority: { read(candidate) { const record = records.get(candidate); if (record === undefined) throw new TypeError("unverified"); return record; } } };
}

function fixture(applicationId = "customer-alpha"): CompileApplicationUpgradeInput {
  const sourceOwnership: GeneratedFileOwnershipManifest = {
    schemaVersion: 1, applicationId, files: [
      { path: "README.md", mode: "template", producer: { package: "@k-nex/runtime", version: "1.0.0", generatorId: "sales-reference" }, digest: applicationUpgradeCompilerDigests.bytes(encode("source template")) },
      { path: "src/generated.ts", mode: "managed", producer: { package: "@k-nex/runtime", version: "1.0.0", generatorId: "sales-reference" }, digest: applicationUpgradeCompilerDigests.bytes(encode("source generated")) },
      { path: "src/migrations/0001.ts", mode: "append-only", producer: { package: "@k-nex/runtime", version: "1.0.0", generatorId: "sales-reference" }, digest: applicationUpgradeCompilerDigests.bytes(encode("migration one")) }
    ]
  };
  const sourceOwnershipDigest = applicationUpgradeCompilerDigests.value(sourceOwnership);
  const sourceManifestDigest = digest("1");
  const sourceReleaseLock: ApplicationReleaseLock = {
    schemaVersion: 1, applicationId, platformRelease: "1.0.0", releaseManifestDigest: sourceManifestDigest,
    frameworkTupleDigest: applicationUpgradeCompilerDigests.value(sourceFramework), packages: [{ package: "@k-nex/runtime", version: "1.0.0", role: "core", integrity: integrity("A") }], plugins: [],
    generator: { package: "@k-nex/runtime", version: "1.0.0", schemaVersion: 1, generatorId: "sales-reference" }, sourceOwnershipDigest, migrationSetDigest: digest("2"), transitionChain: []
  };
  const targetReleaseManifest = {
    schemaVersion: 1, release: { version: "1.1.0", channel: "current", versioningPolicy: "semver-v1", compatibilityPolicy: "exact-framework-tuple" }, framework: targetFramework,
    packages: [{ package: "@k-nex/runtime", version: "1.1.0", role: "core", integrity: targetIntegrity, peerCompatibility: targetFramework }],
    factoryLockTemplates: { minimal: { preset: "sales-reference", theme: "minimal", digest: digest("3") }, neobrutalism: { preset: "sales-reference", theme: "neobrutalism", digest: digest("4") }, "graphite-paper": { preset: "sales-reference", theme: "graphite-paper", digest: digest("5") } },
    supportWindow: { policy: "single-current-release", supportedReleases: ["1.1.0"], securityFixes: "all-supported-releases" }
  };
  const targetReleaseManifestDigest = applicationUpgradeCompilerDigests.value(targetReleaseManifest);
  const transitionManifest = {
    schemaVersion: 1, transitionId: "platform:1.0.0-to-1.1.0", source: { release: "1.0.0", manifestDigest: sourceManifestDigest }, target: { release: "1.1.0", manifestDigest: targetReleaseManifestDigest }, directPredecessors: ["1.0.0"],
    packages: [{ identity: { package: "@k-nex/runtime", role: "core" }, disposition: "upgrade", source: { version: "1.0.0", integrity: integrity("A") }, target: { version: "1.1.0", integrity: targetIntegrity } }],
    generator: { package: "@k-nex/runtime", sourceVersion: "1.0.0", targetVersion: "1.1.0", sourceSchemaVersion: 1, targetSchemaVersion: 2, managedOutputContractDigest: digest("5") }, applicationManifest: { sourceSchemaVersion: 1, targetSchemaVersion: 1 }, framework: { source: sourceFramework, target: targetFramework },
    migrations: { graphDigest: digest("6"), phases: ["offline-required"], steps: [{ id: "sales.0002", phase: "offline-required" }], deliveryClassification: "maintenance-required", rollbackClassification: "source-restore-required" },
    compatibility: { storedDocuments: "migration-required", settings: "migration-required", themeProfiles: "compatible", hotApplicationHostAbiFrom: "1.0.0", hotApplicationHostAbiTo: "1.1.0", themeSkinHostAbiFrom: "1.0.0", themeSkinHostAbiTo: "1.1.0", catalogDigest: digest("7") },
    protection: { preUpgradeBackup: "fresh-required", maximumBackupAgeSeconds: 3600, cleanRestoreDrill: "required", failureRecovery: "restore-source-protection-point", postUpgradeBackup: "required", rollbackWindowSeconds: 86400 },
    lifecycle: { publishedAt: "2026-09-15T10:00:00.000Z", expiresAt: "2027-09-15T10:00:00.000Z", support: "supported", security: "standard", revocation: { status: "active" } }
  };
  const targetOwnership: GeneratedFileOwnershipManifest = {
    schemaVersion: 1, applicationId, files: [
      { path: "README.md", mode: "template", producer: { package: "@k-nex/runtime", version: "1.1.0", generatorId: "sales-reference" }, digest: applicationUpgradeCompilerDigests.bytes(encode("target template")) },
      { path: "src/generated.ts", mode: "managed", producer: { package: "@k-nex/runtime", version: "1.1.0", generatorId: "sales-reference" }, digest: applicationUpgradeCompilerDigests.bytes(encode("target generated")) },
      { path: "src/migrations/0001.ts", mode: "append-only", producer: { package: "@k-nex/runtime", version: "1.0.0", generatorId: "sales-reference" }, digest: applicationUpgradeCompilerDigests.bytes(encode("migration one")) },
      { path: "src/migrations/0002.ts", mode: "append-only", producer: { package: "@k-nex/runtime", version: "1.1.0", generatorId: "sales-reference" }, digest: applicationUpgradeCompilerDigests.bytes(encode("migration two")) }
    ]
  };
  transitionManifest.generator.managedOutputContractDigest = platformReleaseGeneratorContractDigest(sourceReleaseLock.packages[0]!, targetReleaseManifest.packages[0]!);
  const transitionManifestDigest = applicationUpgradeCompilerDigests.value(transitionManifest);
  const targetLock: ApplicationReleaseLock = {
    ...sourceReleaseLock, platformRelease: "1.1.0", releaseManifestDigest: targetReleaseManifestDigest, frameworkTupleDigest: applicationUpgradeCompilerDigests.value(targetFramework),
    packages: [{ package: "@k-nex/runtime", version: "1.1.0", role: "core", integrity: targetIntegrity }], generator: { package: "@k-nex/runtime", version: "1.1.0", schemaVersion: 2, generatorId: "sales-reference" },
    sourceOwnershipDigest: applicationUpgradeCompilerDigests.value(targetOwnership), migrationSetDigest: transitionManifest.migrations.graphDigest,
    transitionChain: [{ transitionId: transitionManifest.transitionId, sourceRelease: "1.0.0", targetRelease: "1.1.0", manifestDigest: transitionManifestDigest }]
  };
  const currentFiles: Record<string, UpgradeRepositoryFile> = {
    ".k-nex/application-plan.json": file("source application plan"), ".k-nex/generated-files.json": file(canonicalGeneratedFileOwnershipManifest(sourceOwnership)), ".k-nex/package-release-manifest.json": file("source release manifest"), ".k-nex/release-lock.json": file(canonicalApplicationReleaseLock(sourceReleaseLock)),
    "README.md": file("customer edited template"), "customer/custom.ts": file("preserve me"), "k-nex.app.json": { kind: "file", bytes: applicationManifestBytes(applicationId) }, "package.json": { kind: "file", bytes: packageJsonBytes("1.0.0") }, "pnpm-lock.yaml": { kind: "file", bytes: pnpmLockBytes("1.0.0") },
    "src/generated.ts": file("source generated"), "src/migrations/0001.ts": file("migration one")
  };
  const targetGeneration: TargetGeneratedApplication = {
    files: { "README.md": encode("target template"), "src/generated.ts": encode("target generated"), "src/migrations/0001.ts": encode("migration one"), "src/migrations/0002.ts": encode("migration two") }, ownership: targetOwnership, releaseLock: targetLock,
    controlFiles: { ".k-nex/application-plan.json": encode("target application plan"), ".k-nex/generated-files.json": encode(canonicalGeneratedFileOwnershipManifest(targetOwnership)), ".k-nex/package-release-manifest.json": encode("target release manifest"), ".k-nex/release-lock.json": encode(canonicalApplicationReleaseLock(targetLock)), ".k-nex/packages/k-nex-runtime-1.1.0.tgz": archiveBytes, "k-nex.app.json": applicationManifestBytes(applicationId), "package.json": packageJsonBytes("1.1.0"), "pnpm-lock.yaml": pnpmLockBytes("1.1.0") }
  };
  const installedInventory = { packages: sourceReleaseLock.packages, plugins: sourceReleaseLock.plugins };
  const transitionAuthorization = authorized<typeof transitionManifest, VerifiedPlatformReleaseTransitionManifest>(transitionManifest);
  const targetReleaseAuthorization = authorized<typeof targetReleaseManifest, VerifiedPackageReleaseManifest>(targetReleaseManifest);
  const targetGenerationAuthorization = authorizedTarget(targetGeneration, { sourceApplicationManifestDigest: applicationUpgradeCompilerDigests.value(JSON.parse(text((currentFiles["k-nex.app.json"] as { kind: "file"; bytes: Uint8Array }).bytes))), sourceCommit, sourceTreeDigest: applicationUpgradeCompilerDigests.repository(currentFiles) });
  const sourceSnapshotAuthorization = authorizedSource(currentFiles, { applicationId, sourceCommit, applicationManifestSchemaVersion: transitionManifest.applicationManifest.sourceSchemaVersion, sourceReleaseLockDigest: applicationUpgradeCompilerDigests.value(sourceReleaseLock), packageAndLockClosureDigest: applicationUpgradeCompilerDigests.value(sourceReleaseLock.packages), applicationManifestPluginGraphDigest: applicationUpgradeCompilerDigests.value(sourceReleaseLock.plugins) });
  return {
    expectedSourceCommit: sourceCommit, actualSourceCommit: sourceCommit, sourceSnapshotAuthority: sourceSnapshotAuthorization.authority, sourceSnapshotToken: sourceSnapshotAuthorization.token, currentFilesDigest: applicationUpgradeCompilerDigests.repository(currentFiles),
    sourceReleaseLock, sourceReleaseLockDigest: applicationUpgradeCompilerDigests.value(sourceReleaseLock), sourceOwnership, sourceOwnershipDigest,
    installedInventory, installedInventoryDigest: applicationUpgradeCompilerDigests.inventory(installedInventory), transitionAuthority: transitionAuthorization.authority as PlatformReleaseTransitionManifestAuthority, transitionToken: transitionAuthorization.token, transitionManifestDigest,
    targetReleaseAuthority: targetReleaseAuthorization.authority as PackageReleaseManifestAuthority, targetReleaseToken: targetReleaseAuthorization.token, targetReleaseManifestDigest, evaluatedAt: "2026-09-15T12:00:00.000Z", targetGenerationAuthority: targetGenerationAuthorization.authority as TargetGeneratedApplicationAuthority, targetGenerationToken: targetGenerationAuthorization.token, targetGenerationDigest: applicationUpgradeCompilerDigests.targetGeneration(targetGeneration)
  };
}

const targetOf = (input: CompileApplicationUpgradeInput) => input.targetGenerationAuthority.read(input.targetGenerationToken).generation;
const sourceOf = (input: CompileApplicationUpgradeInput) => input.sourceSnapshotAuthority.read(input.sourceSnapshotToken).files;

function refreshed(input: CompileApplicationUpgradeInput): CompileApplicationUpgradeInput {
  const target = targetOf(input) as any;
  const transitionManifest = structuredClone(input.transitionAuthority.read(input.transitionToken).manifest) as any;
  const transitionAuthorization = authorized<typeof transitionManifest, VerifiedPlatformReleaseTransitionManifest>(transitionManifest);
  const transitionManifestDigest = applicationUpgradeCompilerDigests.value(transitionManifest);
  target.releaseLock = { ...target.releaseLock, sourceOwnershipDigest: applicationUpgradeCompilerDigests.value(target.ownership) };
  target.releaseLock.transitionChain = target.releaseLock.transitionChain.map((entry: any, index: number, entries: any[]) => index === entries.length - 1 ? { ...entry, manifestDigest: transitionManifestDigest } : entry);
  target.controlFiles = { ...target.controlFiles, ".k-nex/generated-files.json": encode(canonicalGeneratedFileOwnershipManifest(target.ownership)), ".k-nex/release-lock.json": encode(canonicalApplicationReleaseLock(target.releaseLock)) };
  const sourceFiles = sourceOf(input);
  const targetAuthorization = authorizedTarget(target, { sourceApplicationManifestDigest: applicationUpgradeCompilerDigests.value(JSON.parse(text((sourceFiles["k-nex.app.json"] as { kind: "file"; bytes: Uint8Array }).bytes))), sourceCommit: input.actualSourceCommit, sourceTreeDigest: applicationUpgradeCompilerDigests.repository(sourceFiles) });
  const sourceAuthorization = authorizedSource(sourceFiles, { applicationId: input.sourceReleaseLock.applicationId, sourceCommit: input.actualSourceCommit, applicationManifestSchemaVersion: transitionManifest.applicationManifest.sourceSchemaVersion, sourceReleaseLockDigest: applicationUpgradeCompilerDigests.value(input.sourceReleaseLock), packageAndLockClosureDigest: applicationUpgradeCompilerDigests.value(input.sourceReleaseLock.packages), applicationManifestPluginGraphDigest: applicationUpgradeCompilerDigests.value(input.sourceReleaseLock.plugins) });
  return { ...input, transitionAuthority: transitionAuthorization.authority as PlatformReleaseTransitionManifestAuthority, transitionToken: transitionAuthorization.token, transitionManifestDigest, targetGenerationAuthority: targetAuthorization.authority as TargetGeneratedApplicationAuthority, targetGenerationToken: targetAuthorization.token, sourceSnapshotAuthority: sourceAuthorization.authority, sourceSnapshotToken: sourceAuthorization.token, currentFilesDigest: applicationUpgradeCompilerDigests.repository(sourceFiles), sourceReleaseLockDigest: applicationUpgradeCompilerDigests.value(input.sourceReleaseLock), sourceOwnershipDigest: applicationUpgradeCompilerDigests.value(input.sourceOwnership), installedInventoryDigest: applicationUpgradeCompilerDigests.inventory(input.installedInventory), targetGenerationDigest: applicationUpgradeCompilerDigests.targetGeneration(target) };
}

describe("application upgrade compiler", () => {
  it("prepares deterministic two-root-equivalent output and preserves customer/template bytes", () => {
    const left = compileApplicationUpgrade(fixture());
    const reversed = fixture();
    const reversedFiles = Object.fromEntries(Object.entries(sourceOf(reversed)).reverse());
    const reversedAuthorization = authorizedSource(reversedFiles, reversed.sourceSnapshotAuthority.read(reversed.sourceSnapshotToken).binding);
    reversed.sourceSnapshotAuthority = reversedAuthorization.authority; reversed.sourceSnapshotToken = reversedAuthorization.token;
    const right = compileApplicationUpgrade(refreshed(reversed));
    expect(left.outcome).toBe("prepared"); expect(right.outcome).toBe("prepared");
    expect(left.plan).toEqual(right.plan);
    if (left.outcome !== "prepared" || right.outcome !== "prepared") return;
    expect(left.evidence.preparedTreeDigest).toBe(right.evidence.preparedTreeDigest);
    expect(text(left.preparedFiles["customer/custom.ts"]!)).toBe("preserve me");
    expect(text(left.preparedFiles["README.md"]!)).toBe("customer edited template");
    expect(text(left.preparedFiles["src/generated.ts"]!)).toBe("target generated");
    expect(text(left.preparedFiles["src/migrations/0002.ts"]!)).toBe("migration two");
    expect(left.plan.operations.map(({ kind }) => kind)).toContain("append");
    const otherApplication = compileApplicationUpgrade(fixture("customer-beta"));
    expect(otherApplication.outcome).toBe("prepared");
    expect(fixture("customer-beta").transitionManifestDigest).toBe(fixture().transitionManifestDigest);
  });

  it("returns no prepared tree for managed deletion, modified managed bytes, or unowned collision", () => {
    const deletion = fixture();
    const deletionTarget = targetOf(deletion) as any;
    deletionTarget.ownership.files = deletionTarget.ownership.files.filter(({ path }: any) => path !== "src/generated.ts");
    deletionTarget.files = Object.fromEntries(Object.entries(deletionTarget.files).filter(([path]) => path !== "src/generated.ts"));
    const deleted = compileApplicationUpgrade(refreshed(deletion));
    expect(deleted.outcome).toBe("blocked");
    expect(deleted.plan.operations).toContainEqual({ path: "src/generated.ts", kind: "blocked", reason: "managed-delete-reference-proof-required" });
    expect(deleted).not.toHaveProperty("preparedFiles");

    const modified = fixture(); (sourceOf(modified) as any)["src/generated.ts"] = file("customer mutation");
    const conflict = compileApplicationUpgrade(refreshed(modified));
    expect(conflict.outcome).toBe("blocked"); expect(conflict.plan.operations).toContainEqual({ path: "src/generated.ts", kind: "conflict" }); expect(conflict).not.toHaveProperty("preparedFiles");

    const collision = fixture(); (sourceOf(collision) as any)["src/migrations/0002.ts"] = file("customer collision");
    const collided = compileApplicationUpgrade(refreshed(collision));
    expect(collided.outcome).toBe("blocked"); expect(collided.plan.operations).toContainEqual({ path: "src/migrations/0002.ts", kind: "conflict" });

    const rewrittenHistory = fixture();
    const rewrittenTarget = targetOf(rewrittenHistory) as any;
    rewrittenTarget.files["src/migrations/0001.ts"] = encode("rewritten migration");
    rewrittenTarget.ownership.files = rewrittenTarget.ownership.files.map((record: any) => record.path === "src/migrations/0001.ts" ? { ...record, digest: applicationUpgradeCompilerDigests.bytes(encode("rewritten migration")) } : record);
    expect(() => compileApplicationUpgrade(refreshed(rewrittenHistory))).toThrow(/Target ownership producer is outside|append-only/u);
  });

  it("fails stale source, lock, inventory, transition, digest, and symlink inputs before any result", () => {
    const cases: Array<(input: CompileApplicationUpgradeInput) => void> = [
      (input) => { input.actualSourceCommit = "b".repeat(40); }, (input) => { input.sourceReleaseLockDigest = digest("f"); },
      (input) => { input.installedInventory.packages = []; input.installedInventoryDigest = applicationUpgradeCompilerDigests.inventory(input.installedInventory); },
      (input) => { input.transitionManifestDigest = digest("e"); }, (input) => { input.targetGenerationDigest = digest("d"); },
      (input) => { (sourceOf(input) as any)["customer/link"] = { kind: "symlink" }; input.currentFilesDigest = digest("c"); }
    ];
    for (const mutate of cases) { const input = fixture(); mutate(input); expect(() => compileApplicationUpgrade(input)).toThrow(); }
  });

  it("replays the same plan and rejects a stale expected snapshot without partial mutation", () => {
    const input = fixture(); const first = compileApplicationUpgrade(input); const replay = compileApplicationUpgrade(input);
    expect(replay.plan.digest).toBe(first.plan.digest);
    expect(compileApplicationUpgrade({ ...input, expectedInputSnapshotDigest: first.plan.inputSnapshotDigest }).plan.digest).toBe(first.plan.digest);
    expect(() => compileApplicationUpgrade({ ...input, expectedInputSnapshotDigest: digest("f") })).toThrow(/input snapshot is stale/u);
    expect(sourceOf(input)["src/generated.ts"]?.kind === "file" && text((sourceOf(input)["src/generated.ts"] as { kind: "file"; bytes: Uint8Array }).bytes)).toBe("source generated");
    const receipt = createPreparationResultV1({ planDigest: first.plan.digest, preparedSourceCommit: "b".repeat(40), preparedReleaseLockDigest: applicationUpgradeCompilerDigests.value(targetOf(input).releaseLock) });
    expect(receipt.resultDigest).toMatch(/^sha256:/u);
  });

  it("requires current authority, exact archives, generator bindings, and code-unit order", () => {
    const rawSource = fixture(); rawSource.sourceSnapshotToken = Object.freeze({}) as VerifiedSourceApplicationSnapshot;
    expect(() => compileApplicationUpgrade(rawSource)).toThrow(/authority-verified source application snapshot/u);
    const commitSwap = fixture(); commitSwap.expectedSourceCommit = "b".repeat(40); commitSwap.actualSourceCommit = "b".repeat(40);
    expect(() => compileApplicationUpgrade(commitSwap)).toThrow(/target generation does not bind/u);
    const crossedAuthority = fixture(); crossedAuthority.sourceSnapshotToken = crossedAuthority.targetGenerationToken as unknown as VerifiedSourceApplicationSnapshot;
    expect(() => compileApplicationUpgrade(crossedAuthority)).toThrow(/authority-verified source application snapshot/u);
    const sourceMutations: Array<(files: Readonly<Record<string, UpgradeRepositoryFile>>) => void> = [
      (files) => { const manifest = JSON.parse(text((files["k-nex.app.json"] as any).bytes)); manifest.application.id = "drifted-app"; (files as any)["k-nex.app.json"] = { kind: "file", bytes: encode(canonicalJson(manifest)) }; },
      (files) => { const manifest = JSON.parse(text((files["k-nex.app.json"] as any).bytes)); manifest.plugins = [{ id: "module.sales", package: "@k-nex/module-sales", version: "1.0.0", enabled: true }]; (files as any)["k-nex.app.json"] = { kind: "file", bytes: encode(canonicalJson(manifest)) }; },
      (files) => { (files as any)["package.json"] = { kind: "file", bytes: packageJsonBytes("9.9.9") }; },
      (files) => { (files as any)["pnpm-lock.yaml"] = { kind: "file", bytes: pnpmLockBytes("9.9.9") }; },
      (files) => { (files as any)["src/generated.ts"] = file("lifecycle script drift"); }
    ];
    for (const mutate of sourceMutations) {
      const input = fixture(); mutate(sourceOf(input)); input.currentFilesDigest = applicationUpgradeCompilerDigests.repository(sourceOf(input));
      expect(() => compileApplicationUpgrade(input)).toThrow(/source-snapshot authority returned a stale digest binding/u);
    }
    for (const bindingMutation of [
      { applicationId: "drifted-app" },
      { sourceCommit: "b".repeat(40) },
      { applicationManifestSchemaVersion: 2 },
      { packageAndLockClosureDigest: digest("d") },
      { applicationManifestPluginGraphDigest: digest("e") }
    ]) {
      const input = fixture(); const record = input.sourceSnapshotAuthority.read(input.sourceSnapshotToken);
      const authorization = authorizedSource(record.files, { ...record.binding, ...bindingMutation });
      input.sourceSnapshotAuthority = authorization.authority; input.sourceSnapshotToken = authorization.token;
      expect(() => compileApplicationUpgrade(input)).toThrow(/Source application controls do not bind|target generation does not bind/u);
    }

    const raw = fixture();
    raw.transitionToken = Object.freeze({}) as VerifiedPlatformReleaseTransitionManifest;
    expect(() => compileApplicationUpgrade(raw)).toThrow(/authority-verified transition/u);
    const rawTarget = fixture(); rawTarget.targetGenerationToken = Object.freeze({}) as VerifiedTargetGeneratedApplication;
    expect(() => compileApplicationUpgrade(rawTarget)).toThrow(/authority-verified target generation/u);
    const crossedSourceManifest = fixture(); const crossedFiles = structuredClone(sourceOf(crossedSourceManifest)) as Record<string, UpgradeRepositoryFile>;
    const crossedManifest = JSON.parse(text((crossedFiles["k-nex.app.json"] as { kind: "file"; bytes: Uint8Array }).bytes)); crossedManifest.application.name = "Same graph, different preserved config";
    crossedFiles["k-nex.app.json"] = file(canonicalJson(crossedManifest));
    const crossedSourceAuthorization = authorizedSource(crossedFiles, crossedSourceManifest.sourceSnapshotAuthority.read(crossedSourceManifest.sourceSnapshotToken).binding);
    crossedSourceManifest.sourceSnapshotAuthority = crossedSourceAuthorization.authority; crossedSourceManifest.sourceSnapshotToken = crossedSourceAuthorization.token; crossedSourceManifest.currentFilesDigest = applicationUpgradeCompilerDigests.repository(crossedFiles);
    expect(() => compileApplicationUpgrade(crossedSourceManifest)).toThrow(/does not bind the exact source manifest, commit, and repository snapshot/u);
    for (const provenanceMutation of [{ sourceCommit: "b".repeat(40) }, { sourceTreeDigest: digest("f") }]) {
      const input = fixture(); const sourceRecord = input.sourceSnapshotAuthority.read(input.sourceSnapshotToken); const target = targetOf(input);
      const targetAuthorization = authorizedTarget(target, { sourceApplicationManifestDigest: applicationUpgradeCompilerDigests.value(JSON.parse(text((sourceRecord.files["k-nex.app.json"] as { kind: "file"; bytes: Uint8Array }).bytes))), sourceCommit, sourceTreeDigest: sourceRecord.digest, ...provenanceMutation });
      input.targetGenerationAuthority = targetAuthorization.authority; input.targetGenerationToken = targetAuthorization.token;
      expect(() => compileApplicationUpgrade(input)).toThrow(/does not bind the exact source manifest, commit, and repository snapshot/u);
    }
    for (const [path, collection] of [["k-nex.app.json", "controlFiles"], ["package.json", "controlFiles"], ["pnpm-lock.yaml", "controlFiles"], ["src/generated.ts", "files"]] as const) {
      const input = fixture(); const target = targetOf(input); (target[collection] as any)[path] = encode("post-issuance mutation");
      input.targetGenerationDigest = applicationUpgradeCompilerDigests.targetGeneration(target);
      expect(() => compileApplicationUpgrade(input)).toThrow(/authority returned a stale digest binding/u);
    }

    for (const mutate of [
      (input: CompileApplicationUpgradeInput) => { delete (targetOf(input).controlFiles as any)[".k-nex/packages/k-nex-runtime-1.1.0.tgz"]; },
      (input: CompileApplicationUpgradeInput) => { (targetOf(input).controlFiles as any)[".k-nex/packages/k-nex-runtime-1.1.0.tgz"] = encode("tampered"); },
      (input: CompileApplicationUpgradeInput) => { (targetOf(input).controlFiles as any)[".k-nex/packages/extra-1.1.0.tgz"] = encode("extra"); },
      (input: CompileApplicationUpgradeInput) => { (targetOf(input).controlFiles as any)[".k-nex/upgrades/plan.json"] = encode("forbidden"); }
    ]) { const input = fixture(); mutate(input); expect(() => compileApplicationUpgrade(refreshed(input))).toThrow(); }

    const sourceGenerator = fixture();
    sourceGenerator.sourceReleaseLock.generator = { ...sourceGenerator.sourceReleaseLock.generator, schemaVersion: 2 };
    (sourceOf(sourceGenerator) as any)[".k-nex/release-lock.json"] = file(canonicalApplicationReleaseLock(sourceGenerator.sourceReleaseLock));
    expect(() => compileApplicationUpgrade(refreshed(sourceGenerator))).toThrow(/Source generator/u);

    const globalContract = fixture();
    const staleTransition = structuredClone(globalContract.transitionAuthority.read(globalContract.transitionToken).manifest) as any;
    staleTransition.generator.managedOutputContractDigest = digest("f");
    const staleAuthorization = authorized<typeof staleTransition, VerifiedPlatformReleaseTransitionManifest>(staleTransition);
    globalContract.transitionAuthority = staleAuthorization.authority as PlatformReleaseTransitionManifestAuthority; globalContract.transitionToken = staleAuthorization.token;
    expect(() => compileApplicationUpgrade(refreshed(globalContract))).toThrow(/Global generator managed-output contract/u);

    const targetGenerator = fixture();
    const changedTarget = targetOf(targetGenerator) as any;
    changedTarget.releaseLock.generator = { ...changedTarget.releaseLock.generator, generatorId: "other-generator" };
    changedTarget.ownership.files = changedTarget.ownership.files.map((record: any) => ({ ...record, producer: { ...record.producer, generatorId: "other-generator" } }));
    expect(() => compileApplicationUpgrade(refreshed(targetGenerator))).toThrow(/Generator identity changed/u);

    for (const mutate of [
      (chain: any[]) => chain.splice(0, 1),
      (chain: any[]) => { chain[0] = { ...chain[0], sourceRelease: "0.9.0" }; },
      (chain: any[]) => chain.unshift({ transitionId: "platform:0.9.0-to-1.0.0", sourceRelease: "0.9.0", targetRelease: "1.0.0", manifestDigest: digest("c") })
    ]) {
      const input = fixture(); const target = targetOf(input) as any; mutate(target.releaseLock.transitionChain);
      expect(() => compileApplicationUpgrade(refreshed(input))).toThrow(/transition lineage/u);
    }

    for (const lifecycle of [
      { expiresAt: "2026-09-15T11:00:00.000Z" },
      { revocation: { status: "revoked", revokedAt: "2026-09-15T11:00:00.000Z", reasonCode: "SECURITY" } }
    ]) {
      const input = fixture(); const transition = structuredClone(input.transitionAuthority.read(input.transitionToken).manifest) as any;
      Object.assign(transition.lifecycle, lifecycle); const authorization = authorized<typeof transition, VerifiedPlatformReleaseTransitionManifest>(transition);
      input.transitionAuthority = authorization.authority as PlatformReleaseTransitionManifestAuthority; input.transitionToken = authorization.token;
      expect(() => compileApplicationUpgrade(refreshed(input))).toThrow(/not current and active/u);
    }

    const ordered = fixture();
    for (const path of ["src/é.ts", "src/Z.ts", "src/!.ts"]) {
      const bytes = encode(path); (targetOf(ordered).files as any)[path] = bytes;
      (targetOf(ordered).ownership.files as any).push({ path, mode: "managed", producer: { package: "@k-nex/runtime", version: "1.1.0", generatorId: "sales-reference" }, digest: applicationUpgradeCompilerDigests.bytes(bytes) });
    }
    (targetOf(ordered).ownership.files as any).sort((left: any, right: any) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const result = compileApplicationUpgrade(refreshed(ordered));
    expect(result.plan.operations.filter(({ path }) => ["src/!.ts", "src/Z.ts", "src/é.ts"].includes(path)).map(({ path }) => path)).toEqual(["src/!.ts", "src/Z.ts", "src/é.ts"]);
  });
});
