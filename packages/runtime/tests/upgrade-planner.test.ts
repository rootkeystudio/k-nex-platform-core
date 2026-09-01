import { describe, expect, it } from "vitest";

import { supportedFrameworkTuple, type PackageReleaseManifest } from "@k-nex/contracts";

import { dryRunPluginUpgrade, planPluginUpgrade, type UpgradeMigration, type UpgradeTarget } from "../src/index.js";

const kinds = ["customer-schema", "source", "action", "tool", "block", "theme", "template", "settings"] as const;
const targets: UpgradeTarget[] = kinds.map((kind) => ({ artifactId: `fixture.${kind}`, kind, currentRevision: 1, targetRevision: 2 }));
const migrations: UpgradeMigration[] = kinds.map((kind) => ({
  id: `fixture.migration.${kind}.v2`, artifactId: `fixture.${kind}`, kind, fromRevision: 1, toRevision: 2,
  predecessorRevisions: [1], dependsOn: kind === "customer-schema" ? [] : ["fixture.customer-schema@2"],
  migrate: (value) => ({ ...(value as object), revision: 2 }),
  validate: (value) => typeof value === "object" && value !== null && "revision" in value && value.revision === 2
}));
const targetReleaseManifest = {
  schemaVersion: 1, release: { version: "1.0.0", channel: "current", versioningPolicy: "semver-v1", compatibilityPolicy: "exact-framework-tuple" },
  framework: supportedFrameworkTuple,
  packages: [{ package: "@fixture/module-upgrade", version: "1.0.1", role: "plugin", integrity: `sha512-${"a".repeat(86)}==`, peerCompatibility: supportedFrameworkTuple }],
  supportWindow: { policy: "single-current-release", supportedReleases: ["1.0.0"], securityFixes: "all-supported-releases" }
} as const satisfies PackageReleaseManifest;
const currentReleaseManifest = {
  ...targetReleaseManifest,
  release: targetReleaseManifest.release,
  packages: [{ ...targetReleaseManifest.packages[0], version: "0.9.0", integrity: `sha512-${"b".repeat(86)}==` }],
  supportWindow: targetReleaseManifest.supportWindow
} as const satisfies PackageReleaseManifest;
const support = { currentPlatformRelease: "1.0.0", targetPlatformRelease: "1.0.0", currentReleaseManifest, targetReleaseManifest, packageName: "@fixture/module-upgrade" } as const;

describe("plugin upgrade planner", () => {
  it("orders the customer migration before every Sales artifact migration and dry-runs all evolution domains", () => {
    const plan = planPluginUpgrade({ ...support, pluginId: "module.fixture", currentVersion: "0.9.0", targetVersion: "1.0.1", targets, migrations });
    expect(plan.ready).toBe(true);
    expect(plan.steps.map(({ kind }) => kind)).toEqual(kinds);
    const original = Object.fromEntries(targets.map(({ artifactId }) => [artifactId, { revision: 1, preserved: artifactId }]));
    const before = structuredClone(original);
    const result = dryRunPluginUpgrade(plan, original);
    expect(result.ready).toBe(true);
    expect(original).toEqual(before);
    expect(Object.values(result.artifacts)).toEqual(targets.map(({ artifactId }) => ({ revision: 2, preserved: artifactId })));
  });

  it("fails preflight on gaps, duplicate revisions, invalid predecessors, and dependency cycles", () => {
    const gap = planPluginUpgrade({ ...support, pluginId: "module.fixture", currentVersion: "0.9.0", targetVersion: "1.0.1", targets: [targets[0]!], migrations: [] });
    expect(gap).toMatchObject({ ready: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "GAP" })]) });

    const base = migrations[0]!;
    const invalid = planPluginUpgrade({
      ...support, pluginId: "module.fixture", currentVersion: "0.9.0", targetVersion: "1.0.1", targets: [targets[0]!],
      migrations: [{ ...base, predecessorRevisions: [] }, base, base]
    });
    expect(invalid.ready).toBe(false);
    expect(invalid.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["INVALID", "DUPLICATE"]));

    const cycleStep = { ...base, dependsOn: ["fixture.customer-schema@2"] };
    const cycle = planPluginUpgrade({ ...support, pluginId: "module.fixture", currentVersion: "0.9.0", targetVersion: "1.0.1", targets: [targets[0]!], migrations: [cycleStep] });
    expect(cycle.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CYCLE" })]));
  });

  it("reports dry-run migration failures without changing its input", () => {
    const broken = [{ ...migrations[0]!, migrate: () => { throw new Error("boom"); } }];
    const plan = planPluginUpgrade({ ...support, pluginId: "module.fixture", currentVersion: "0.9.0", targetVersion: "1.0.1", targets: [targets[0]!], migrations: broken });
    const artifacts = { "fixture.customer-schema": { revision: 1 } };
    const result = dryRunPluginUpgrade(plan, artifacts);
    expect(result).toMatchObject({ ready: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "MIGRATION_FAILED" })]) });
    expect(artifacts["fixture.customer-schema"].revision).toBe(1);
  });

  it("refuses stale dry-run artifacts and unknown graph dependencies", () => {
    const unknownDependency = [{ ...migrations[0]!, dependsOn: ["sales.unknown@2"] }];
    const invalid = planPluginUpgrade({ ...support, pluginId: "module.fixture", currentVersion: "0.9.0", targetVersion: "1.0.1", targets: [targets[0]!], migrations: unknownDependency });
    expect(invalid).toMatchObject({ ready: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "INVALID" })]) });

    const plan = planPluginUpgrade({ ...support, pluginId: "module.fixture", currentVersion: "0.9.0", targetVersion: "1.0.1", targets: [targets[0]!], migrations: [migrations[0]!] });
    const stale = dryRunPluginUpgrade(plan, { "fixture.customer-schema": { revision: 0 } });
    expect(stale).toMatchObject({ ready: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "REVISION_MISMATCH" })]) });
  });

  it("rejects a platform source outside the current release support window", () => {
    const plan = planPluginUpgrade({ ...support, currentPlatformRelease: "0.0.1", pluginId: "module.fixture", currentVersion: "0.9.0", targetVersion: "1.0.1", targets, migrations });
    expect(plan).toMatchObject({ ready: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "UNSUPPORTED_RELEASE" })]) });
  });

  it("rejects invented plugin target versions outside the trusted release artifact", () => {
    const plan = planPluginUpgrade({ ...support, pluginId: "module.fixture", currentVersion: "0.9.0", targetVersion: "9.9.9", targets, migrations });
    expect(plan).toMatchObject({ ready: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "UNSUPPORTED_RELEASE" })]) });
  });
});
