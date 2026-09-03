import { describe, expect, it } from "vitest";

import { PackageReleaseManifestSchema, supportedFrameworkTuple } from "../src/index.js";

const integrity = `sha512-${"A".repeat(86)}==`;
const valid = {
  schemaVersion: 1,
  release: { version: "1.0.0", channel: "current", versioningPolicy: "semver-v1", compatibilityPolicy: "exact-framework-tuple" },
  framework: supportedFrameworkTuple,
  factoryLockTemplates: {
    minimal: { preset: "sales-reference", theme: "minimal", digest: `sha256:${"1".repeat(64)}` },
    neobrutalism: { preset: "sales-reference", theme: "neobrutalism", digest: `sha256:${"2".repeat(64)}` }
  },
  packages: [
    { package: "@k-nex/runtime", version: "1.0.0", role: "core", integrity, peerCompatibility: supportedFrameworkTuple },
    { package: "@k-nex/module-sales", version: "1.0.0", role: "plugin", integrity, peerCompatibility: supportedFrameworkTuple }
  ],
  supportWindow: { policy: "single-current-release", supportedReleases: ["1.0.0"], securityFixes: "all-supported-releases" }
} as const;

describe("package release manifest", () => {
  it("binds exact package versions and integrity to one framework tuple and bounded support window", () => {
    expect(PackageReleaseManifestSchema.parse(valid)).toEqual(valid);
  });

  it("rejects duplicate packages, non-SHA512 integrity, and package tuple drift", () => {
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, packages: [...valid.packages, valid.packages[0]] }).success).toBe(false);
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, packages: [{ ...valid.packages[0], integrity: `sha256-${"a".repeat(64)}` }] }).success).toBe(false);
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, packages: [{ ...valid.packages[0], peerCompatibility: { ...supportedFrameworkTuple, node: "24.0.0" } }] }).success).toBe(false);
  });

  it("rejects a non-current or multi-release support window", () => {
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, supportWindow: { ...valid.supportWindow, supportedReleases: ["1.0.1"] } }).success).toBe(false);
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, supportWindow: { ...valid.supportWindow, supportedReleases: ["1.0.0", "1.0.1"] } }).success).toBe(false);
  });

  it("binds exactly the two content-addressed Sales factory lock templates", () => {
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, factoryLockTemplates: { minimal: valid.factoryLockTemplates.minimal } }).success).toBe(false);
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, factoryLockTemplates: { ...valid.factoryLockTemplates, extra: valid.factoryLockTemplates.minimal } }).success).toBe(false);
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, factoryLockTemplates: { ...valid.factoryLockTemplates, minimal: { ...valid.factoryLockTemplates.minimal, digest: "sha256:forged" } } }).success).toBe(false);
  });
});
