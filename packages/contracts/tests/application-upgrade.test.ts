import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ApplicationReleaseLockSchema,
  ApplicationUpgradePlanEnvelopeV1Schema,
  GeneratedFileOwnershipManifestSchema,
  PreparationResultV1Schema,
  applicationUpgradePlanDigestInput,
  canonicalJson,
  platformReleaseGeneratorContractDigest,
  preparationResultDigestInput,
  sha256CanonicalJson
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const integrity = `sha512-${"A".repeat(86)}==`;
const ownership = {
  schemaVersion: 1, applicationId: "customer-alpha", files: [
    { path: "src/generated.ts", mode: "managed", producer: { package: "@k-nex/runtime", version: "1.0.0", generatorId: "sales-reference" }, digest: digest("1") },
    { path: "src/migrations/0001.ts", mode: "append-only", producer: { package: "@k-nex/runtime", version: "1.0.0", generatorId: "sales-reference" }, digest: digest("2") }
  ]
} as const;
const lock = {
  schemaVersion: 1, applicationId: "customer-alpha", platformRelease: "1.0.0", releaseManifestDigest: digest("3"), frameworkTupleDigest: digest("4"),
  packages: [{ package: "@k-nex/runtime", version: "1.0.0", role: "core", integrity }], plugins: [],
  generator: { package: "@k-nex/runtime", version: "1.0.0", schemaVersion: 1, generatorId: "sales-reference" }, sourceOwnershipDigest: digest("5"), migrationSetDigest: digest("6"), transitionChain: []
} as const;

describe("application upgrade contracts", () => {
  it("matches canonical SHA-256 with the platform implementation", () => {
    const value = { unicode: "é", punctuation: "!_", nested: { z: 1, a: true } };
    expect(sha256CanonicalJson(value)).toBe(`sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`);
  });
  it("binds the global generator contract only to release package endpoints", () => {
    const source = { package: "@k-nex/runtime", version: "1.0.0", integrity };
    const target = { package: "@k-nex/runtime", version: "1.1.0", integrity: `sha512-${"B".repeat(86)}==` };
    expect(platformReleaseGeneratorContractDigest(source, target)).toBe(sha256CanonicalJson({ package: target.package, sourceVersion: source.version, targetVersion: target.version, sourceIntegrity: source.integrity, targetIntegrity: target.integrity }));
    expect(() => platformReleaseGeneratorContractDigest(source, { ...target, package: "@k-nex/other" })).toThrow(/same package/u);
  });
  it("accepts sorted generated ownership and excludes every release-control class", () => {
    expect(GeneratedFileOwnershipManifestSchema.parse(ownership)).toEqual(ownership);
    expect(GeneratedFileOwnershipManifestSchema.safeParse({ ...ownership, files: [...ownership.files].reverse() }).success).toBe(false);
    for (const path of ["k-nex.app.json", "package.json", "pnpm-lock.yaml", ".k-nex/application-plan.json", ".k-nex/package-release-manifest.json", ".k-nex/release-lock.json", ".k-nex/generated-files.json", ".k-nex/packages/runtime.tgz", ".k-nex/upgrades/plan.json"]) {
      expect(GeneratedFileOwnershipManifestSchema.safeParse({ ...ownership, files: [{ ...ownership.files[0], path }] }).success, path).toBe(false);
    }
  });

  it("binds one-way release-lock ownership and exact plugin/package identities", () => {
    expect(ApplicationReleaseLockSchema.parse(lock)).toEqual(lock);
    const packages = [
      { package: "@k-nex/module-sales", version: "1.0.0", role: "plugin", integrity },
      { package: "@k-nex/provider-realtime-socketio", version: "1.0.0", role: "provider", integrity },
      ...lock.packages
    ] as const;
    const plugins = [
      { id: "module.sales", package: "@k-nex/module-sales", version: "1.0.0", integrity },
      { id: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: "1.0.0", integrity }
    ] as const;
    expect(ApplicationReleaseLockSchema.safeParse({ ...lock, packages, plugins }).success).toBe(true);
    expect(ApplicationReleaseLockSchema.safeParse({ ...lock, packages: packages.map((entry) => entry.package === "@k-nex/provider-realtime-socketio" ? { ...entry, role: "plugin" } : entry), plugins }).success).toBe(false);
    expect(ApplicationReleaseLockSchema.safeParse({ ...lock, digest: digest("9") }).success).toBe(false);
  });

  it("keeps the public plan minimal, relative, sorted, and digest-projectable", () => {
    const withoutDigest = { schemaVersion: 1, planId: "upgrade:abc", inputSnapshotDigest: digest("1"), targetTransitionManifestDigest: digest("2"), operations: [{ path: "src/a.ts", kind: "replace" }, { path: "src/b.ts", kind: "blocked", reason: "managed-delete-reference-proof-required" }] } as const;
    const plan = { ...withoutDigest, digest: sha256CanonicalJson(applicationUpgradePlanDigestInput(withoutDigest)) } as const;
    expect(ApplicationUpgradePlanEnvelopeV1Schema.parse(plan)).toEqual(plan);
    expect(applicationUpgradePlanDigestInput(plan)).not.toHaveProperty("digest");
    expect(ApplicationUpgradePlanEnvelopeV1Schema.safeParse({ ...plan, operations: [...plan.operations].reverse() }).success).toBe(false);
    expect(ApplicationUpgradePlanEnvelopeV1Schema.safeParse({ ...plan, operations: [{ path: "src/a.ts", kind: "add" }] }).success).toBe(false);
    const changed = { ...withoutDigest, operations: [{ path: "src/a.ts", kind: "add" }] } as const;
    expect(ApplicationUpgradePlanEnvelopeV1Schema.safeParse({ ...changed, digest: sha256CanonicalJson(applicationUpgradePlanDigestInput(changed)) }).success).toBe(true);
    expect(ApplicationUpgradePlanEnvelopeV1Schema.safeParse({ ...plan, operations: [{ path: "/tmp/owned.ts", kind: "add" }] }).success).toBe(false);
    for (const field of ["bytes", "repositoryUrl", "shell", "sql", "backupPath", "credential"]) expect(ApplicationUpgradePlanEnvelopeV1Schema.safeParse({ ...plan, [field]: "authority" }).success).toBe(false);
  });

  it("defines a one-way preparation-result digest projection", () => {
    const withoutDigest = { schemaVersion: 1, planDigest: digest("1"), preparedSourceCommit: "a".repeat(40), preparedReleaseLockDigest: digest("2") } as const;
    const result = { ...withoutDigest, resultDigest: sha256CanonicalJson(preparationResultDigestInput(withoutDigest)) } as const;
    expect(PreparationResultV1Schema.parse(result)).toEqual(result);
    expect(PreparationResultV1Schema.safeParse({ ...result, planDigest: digest("9") }).success).toBe(false);
    const changed = { ...withoutDigest, planDigest: digest("9") };
    expect(PreparationResultV1Schema.safeParse({ ...changed, resultDigest: sha256CanonicalJson(preparationResultDigestInput(changed)) }).success).toBe(true);
    expect(canonicalJson(preparationResultDigestInput(result))).not.toContain("resultDigest");
  });
});
