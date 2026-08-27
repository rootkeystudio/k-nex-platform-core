import { describe, expect, it } from "vitest";

import { PackageReleaseManifestSchema, supportedFrameworkTuple } from "../src/index.js";

const integrity = `sha512-${"A".repeat(86)}==`;
const valid = {
  schemaVersion: 1,
  release: { version: "0.8.0", channel: "pre-v1", versioningPolicy: "semver-pre-v1", compatibilityPolicy: "exact-framework-tuple" },
  framework: supportedFrameworkTuple,
  packages: [
    { package: "@k-nex/runtime", version: "0.8.0", role: "core", integrity, peerCompatibility: supportedFrameworkTuple },
    { package: "@k-nex/module-sales", version: "1.0.0", role: "plugin", integrity, peerCompatibility: supportedFrameworkTuple }
  ],
  supportWindow: { policy: "current-and-one-prior-minor", supportedReleases: ["0.8.0", "0.7.4"], securityFixes: "all-supported-releases" }
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

  it("rejects support windows that skip a minor or do not start with the current release", () => {
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, supportWindow: { ...valid.supportWindow, supportedReleases: ["0.7.4"] } }).success).toBe(false);
    expect(PackageReleaseManifestSchema.safeParse({ ...valid, supportWindow: { ...valid.supportWindow, supportedReleases: ["0.8.0", "0.6.9"] } }).success).toBe(false);
  });
});
