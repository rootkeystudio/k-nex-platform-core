import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  canonicalPlatformReleaseTransitionManifest,
  PackageReleaseManifestSchema,
  PlatformReleaseTransitionManifestSchema,
  validatePlatformReleaseTransition
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const integrity = (character: string) => `sha512-${character.repeat(86)}==`;
const sourceFramework = { core: "1.0.0", payload: "3.88.0", node: "24.19.0", pnpm: "11.9.0", payloadDatabaseAdapter: "postgres" } as const;
const targetFramework = { ...sourceFramework, core: "1.1.0" } as const;

function release(version: "1.0.0" | "1.1.0", framework: typeof sourceFramework | typeof targetFramework, sourceCharacter: string, targetCharacter: string) {
  return PackageReleaseManifestSchema.parse({
    schemaVersion: 1,
    release: { version, channel: "current", versioningPolicy: "semver-v1", compatibilityPolicy: "exact-framework-tuple" },
    framework,
    packages: [
      { package: "@k-nex/runtime", version, role: "core", integrity: integrity(sourceCharacter), peerCompatibility: framework },
      { package: "@k-nex/module-sales", version, role: "plugin", integrity: integrity(targetCharacter), peerCompatibility: framework }
    ],
    factoryLockTemplates: {
      minimal: { preset: "sales-reference", theme: "minimal", digest: digest("1") },
      neobrutalism: { preset: "sales-reference", theme: "neobrutalism", digest: digest("2") }
    },
    supportWindow: { policy: "single-current-release", supportedReleases: [version], securityFixes: "all-supported-releases" }
  });
}

const sourceManifest = release("1.0.0", sourceFramework, "A", "B");
const targetManifest = release("1.1.0", targetFramework, "C", "D");
const sourceDigest = digest("a");
const targetDigest = digest("b");
const evaluatedAt = "2026-09-16T10:00:00.000Z";

const valid = {
  "$schema": "../../schemas/platform-release-transition-manifest.v1.schema.json",
  schemaVersion: 1,
  transitionId: "platform:1.0.0-to-1.1.0",
  source: { release: "1.0.0", manifestDigest: sourceDigest },
  target: { release: "1.1.0", manifestDigest: targetDigest },
  directPredecessors: ["1.0.0"],
  packages: [
    { identity: { package: "@k-nex/runtime", role: "core" }, disposition: "upgrade", source: { version: "1.0.0", integrity: integrity("A") }, target: { version: "1.1.0", integrity: integrity("C") } },
    { identity: { package: "@k-nex/module-sales", role: "plugin", pluginId: "module.sales" }, disposition: "upgrade", source: { version: "1.0.0", integrity: integrity("B") }, target: { version: "1.1.0", integrity: integrity("D") } }
  ],
  generator: { package: "@k-nex/runtime", sourceVersion: "1.0.0", targetVersion: "1.1.0", sourceSchemaVersion: 1, targetSchemaVersion: 2, managedOutputContractDigest: digest("c") },
  applicationManifest: { sourceSchemaVersion: 1, targetSchemaVersion: 1 },
  framework: { source: sourceFramework, target: targetFramework },
  migrations: { graphDigest: digest("d"), phases: ["offline-required"], deliveryClassification: "maintenance-required", rollbackClassification: "source-restore-required" },
  compatibility: {
    storedDocuments: "migration-required", settings: "migration-required", themeProfiles: "compatible",
    hotApplicationHostAbiFrom: "1.0.0", hotApplicationHostAbiTo: "1.1.0",
    themeSkinHostAbiFrom: "1.0.0", themeSkinHostAbiTo: "1.1.0", catalogDigest: digest("e")
  },
  protection: {
    preUpgradeBackup: "fresh-required", maximumBackupAgeSeconds: 3600, cleanRestoreDrill: "required",
    failureRecovery: "restore-source-protection-point", postUpgradeBackup: "required", rollbackWindowSeconds: 86400
  },
  lifecycle: { publishedAt: "2026-09-15T10:00:00.000Z", expiresAt: "2027-09-15T10:00:00.000Z", support: "supported", security: "standard", revocation: { status: "active" } }
} as const;

describe("platform release transition manifest", () => {
  it("binds one direct immutable release hop and exact verified package closures", () => {
    expect(PlatformReleaseTransitionManifestSchema.parse(valid)).toEqual(valid);
    expect(validatePlatformReleaseTransition(valid, { manifest: sourceManifest, digest: sourceDigest }, { manifest: targetManifest, digest: targetDigest }, evaluatedAt)).toEqual(valid);
  });

  it("has stable canonical bytes independent of object insertion order", () => {
    const reordered = Object.fromEntries(Object.entries(valid).reverse());
    expect(canonicalPlatformReleaseTransitionManifest(reordered)).toBe(canonicalJson(valid));
  });

  it("rejects duplicate package or plugin mappings and a missing exact closure member", () => {
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, packages: [...valid.packages, valid.packages[0]] }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, packages: [...valid.packages, { ...valid.packages[1], identity: { ...valid.packages[1].identity, package: "@k-nex/other" } }] }).success).toBe(false);
    const missing = { ...valid, packages: valid.packages.slice(0, 1) };
    expect(() => validatePlatformReleaseTransition(missing, { manifest: sourceManifest, digest: sourceDigest }, { manifest: targetManifest, digest: targetDigest }, evaluatedAt)).toThrow(/missing from the transition mapping/u);
  });

  it("rejects stale endpoint digests and ambiguous or forged package mapping bytes", () => {
    expect(() => validatePlatformReleaseTransition(valid, { manifest: sourceManifest, digest: digest("f") }, { manifest: targetManifest, digest: targetDigest }, evaluatedAt)).toThrow(/source release identity or manifest digest/u);
    const forged = { ...valid, packages: [{ ...valid.packages[0], target: { ...valid.packages[0].target, integrity: integrity("E") } }, valid.packages[1]] };
    expect(() => validatePlatformReleaseTransition(forged, { manifest: sourceManifest, digest: sourceDigest }, { manifest: targetManifest, digest: targetDigest }, evaluatedAt)).toThrow(/does not equal the exact source and target release entries/u);
  });

  it("rejects false delivery, rollback, predecessor, expiry, and train claims", () => {
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, directPredecessors: ["0.9.0"] }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, migrations: { ...valid.migrations, deliveryClassification: "zero-downtime-eligible" } }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, protection: { ...valid.protection, cleanRestoreDrill: "risk-policy" } }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, lifecycle: { ...valid.lifecycle, expiresAt: valid.lifecycle.publishedAt } }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, packages: [{ ...valid.packages[0], target: { ...valid.packages[0].target, version: "1.2.0" } }, valid.packages[1]] }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, migrations: { ...valid.migrations, phases: ["offline-required", "online-expand"] } }).success).toBe(false);
  });

  it("uses closed disposition-specific endpoint shapes and reconciles additions and removals", () => {
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, packages: [{ ...valid.packages[0], disposition: "add-for-generator" }, valid.packages[1]] }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, packages: [{ identity: valid.packages[0].identity, disposition: "remove", source: valid.packages[0].source, target: valid.packages[0].target }, valid.packages[1]] }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, packages: [{ identity: valid.packages[0].identity, disposition: "replacement-required", source: valid.packages[0].source, target: valid.packages[0].target }, valid.packages[1]] }).success).toBe(false);

    const targetWithAdded = PackageReleaseManifestSchema.parse({ ...targetManifest, packages: [...targetManifest.packages, { package: "@k-nex/upgrade-tool", version: "1.1.0", role: "tooling", integrity: integrity("E"), peerCompatibility: targetFramework }] });
    const withAdded = { ...valid, packages: [...valid.packages, { identity: { package: "@k-nex/upgrade-tool", role: "tooling" }, disposition: "add-for-generator", target: { version: "1.1.0", integrity: integrity("E") } }] };
    expect(validatePlatformReleaseTransition(withAdded, { manifest: sourceManifest, digest: sourceDigest }, { manifest: targetWithAdded, digest: targetDigest }, evaluatedAt).packages).toHaveLength(3);

    const targetWithoutSales = PackageReleaseManifestSchema.parse({ ...targetManifest, packages: targetManifest.packages.slice(0, 1) });
    const withRemoval = { ...valid, packages: [valid.packages[0], { identity: valid.packages[1].identity, disposition: "remove", source: valid.packages[1].source }] };
    expect(validatePlatformReleaseTransition(withRemoval, { manifest: sourceManifest, digest: sourceDigest }, { manifest: targetWithoutSales, digest: targetDigest }, evaluatedAt).packages).toHaveLength(2);
    expect(() => validatePlatformReleaseTransition(withRemoval, { manifest: sourceManifest, digest: sourceDigest }, { manifest: targetManifest, digest: targetDigest }, evaluatedAt)).toThrow(/disposition must be upgrade/u);
  });

  it("requires fresh backup, clean restore proof, and restore rollback for every high-risk transition", () => {
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, protection: { ...valid.protection, preUpgradeBackup: "restore-verified-within-window" } }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, protection: { ...valid.protection, cleanRestoreDrill: "risk-policy" } }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, migrations: { ...valid.migrations, rollbackClassification: "source-generation" } }).success).toBe(false);
  });

  it("fails closed for a revoked or expired transition", () => {
    const revoked = { ...valid, lifecycle: { ...valid.lifecycle, revocation: { status: "revoked", revokedAt: "2026-09-16T09:00:00.000Z", reasonCode: "SECURITY_WITHDRAWAL" } } };
    expect(() => validatePlatformReleaseTransition(revoked, { manifest: sourceManifest, digest: sourceDigest }, { manifest: targetManifest, digest: targetDigest }, evaluatedAt)).toThrow(/transition is revoked/u);
    expect(() => validatePlatformReleaseTransition(valid, { manifest: sourceManifest, digest: sourceDigest }, { manifest: targetManifest, digest: targetDigest }, "2026-09-15T09:59:59.999Z")).toThrow(/transition is not yet published/u);
    expect(() => validatePlatformReleaseTransition(valid, { manifest: sourceManifest, digest: sourceDigest }, { manifest: targetManifest, digest: targetDigest }, valid.lifecycle.expiresAt)).toThrow(/transition is expired/u);
  });

  it("cannot carry authority-bearing URLs, shell, SQL, secret, or source-path fields", () => {
    for (const injected of [
      { artifactUrl: "https://attacker.example/package.tgz" },
      { shell: "pnpm add attacker" },
      { sql: "DROP TABLE users" },
      { secret: "plaintext" },
      { repositoryPath: "/tmp/customer" }
    ]) expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, ...injected }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, source: { ...valid.source, manifestUrl: "https://attacker.example/manifest.json" } }).success).toBe(false);
    expect(PlatformReleaseTransitionManifestSchema.safeParse({ ...valid, "$schema": "https://attacker.example/schema.json" }).success).toBe(false);
  });
});
