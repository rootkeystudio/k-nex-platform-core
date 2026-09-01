import { describe, expect, it } from "vitest";

import { ExtensionInstallPlanSchema, HotApplicationConcreteRouteSchema, HotApplicationManifestSchema, MigrationCompatibilityPlanSchema, StaticCompositionChangePlanSchema, StaticDeploymentReceiptSchema, ThemeSkinTokenValueSchema, hotApplicationHostRouteTemplate, matchHotApplicationRoute } from "../src/extension-runtime.js";

const manifest = {
  schemaVersion: 1, deliveryClass: "hot-application", id: "app.foo.bar", displayName: "Dotted routes", version: "1.0.0", runtimeAbi: "1.0.0",
  entrypoints: { server: [], ui: ["ui/main.mjs"] }, capabilities: [],
  resourceBudget: { maxBundleBytes: 1, maxAssetBytes: 1, maxStorageBytes: 1, maxMemoryMiB: 1, maxCpuMilliCores: 1, maxWallTimeMs: 1, maxInputBytes: 1, maxOutputBytes: 1, maxLogBytes: 1, maxConcurrency: 1 },
  permissions: [], policyBindings: [], settings: [], screens: [{ id: "foo.task", route: "/tasks/:taskid", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: [], localization: [], healthChecks: []
} as const;

describe("Hot Application routes", () => {
  it("keeps signed templates relative and resolves owner-exact concrete paths", () => {
    expect(HotApplicationManifestSchema.parse(manifest).id).toBe("app.foo.bar");
    expect(HotApplicationManifestSchema.safeParse({ ...manifest, screens: [{ ...manifest.screens[0], route: "/apps/foo.bar/tasks/:taskid" }] }).success).toBe(false);
    expect(hotApplicationHostRouteTemplate("app.foo.bar", "/tasks/:taskid")).toBe("/apps/foo.bar/tasks/:taskid");
    expect(hotApplicationHostRouteTemplate("app.foo.bar", "/")).toBe("/apps/foo.bar");
    expect(HotApplicationConcreteRouteSchema.safeParse("/apps/foo.bar/tasks/42").success).toBe(true);
    expect(matchHotApplicationRoute("app.foo.bar", "/tasks/:taskid", "/apps/foo.bar/tasks/42")).toBe(true);
    expect(matchHotApplicationRoute("app.foo.bar", "/tasks/:taskid", "/apps/foo-bar/tasks/42")).toBe(false);
    expect(matchHotApplicationRoute("app.foo.bar", "/tasks/:taskid", "/apps/foo.bar/tasks/42/other")).toBe(false);
    expect(matchHotApplicationRoute("app.foo.bar", "/tasks/:taskid", "/apps/foo.bar/tasks/../admin")).toBe(false);
    expect(matchHotApplicationRoute("app.foo.bar", "/tasks/:taskid", "/apps/foo.bar/tasks/%2e%2e")).toBe(false);
  });
});

describe("Hot Application authorization declarations", () => {
  const authorization = {
    permissions: [{
      schemaVersion: 1,
      id: "foo.bar.tasks.read",
      publisher: { kind: "extension", deliveryClass: "hot-application", extensionId: "app.foo.bar" },
      title: "Read tasks",
      description: "Read actor-authorized tasks.",
      audience: "authenticated",
      resource: "foo.bar.tasks",
      operation: "read",
      scope: "record"
    }],
    policyBindings: [{
      schemaVersion: 1,
      id: "foo.bar.policy.tasks-read",
      publisher: { kind: "extension", deliveryClass: "hot-application", extensionId: "app.foo.bar" },
      permissionId: "foo.bar.tasks.read",
      policyReference: "foo.bar.policy.tasks-read",
      scope: "record",
      failureMode: "deny",
      timeoutMs: 5_000
    }],
    roleTemplates: [{
      schemaVersion: 1,
      id: "foo.bar.template.viewer",
      publisher: { kind: "extension", deliveryClass: "hot-application", extensionId: "app.foo.bar" },
      version: 1,
      instantiation: "manual",
      title: "Task viewer",
      permissionIds: ["foo.bar.tasks.read"]
    }]
  } as const;

  it("accepts only closed, manifest-owned data declarations", () => {
    expect(HotApplicationManifestSchema.safeParse({ ...manifest, ...authorization }).success).toBe(true);
    expect(HotApplicationManifestSchema.safeParse({ ...manifest, ...authorization, permissions: [{ ...authorization.permissions[0], policy: "export default allow" }] }).success).toBe(false);
    expect(HotApplicationManifestSchema.safeParse({ ...manifest, permissions: undefined }).success).toBe(false);
  });

  it.each([
    ["same-namespace Platform Plugin publisher", { ...authorization, permissions: [{ ...authorization.permissions[0], publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.foo.bar" } }] }],
    ["Theme Skin publisher", { ...authorization, permissions: [{ ...authorization.permissions[0], publisher: { kind: "extension", deliveryClass: "theme-skin", extensionId: "skin.foo.bar" } }] }],
    ["system publisher", { ...authorization, policyBindings: [{ ...authorization.policyBindings[0], publisher: { kind: "platform", namespace: "system" } }] }],
    ["undeclared permission", { ...authorization, policyBindings: [{ ...authorization.policyBindings[0], permissionId: "foo.bar.tasks.write" }] }],
    ["undeclared template permission", { ...authorization, roleTemplates: [{ ...authorization.roleTemplates[0], permissionIds: ["foo.bar.tasks.write"] }] }],
    ["duplicate descriptor ID", { ...authorization, permissions: [authorization.permissions[0], { ...authorization.permissions[0], title: "Duplicated task reader" }] }],
    ["duplicate policy binding ID", { ...authorization, policyBindings: [authorization.policyBindings[0], { ...authorization.policyBindings[0], timeoutMs: 4_999 }] }]
  ] as const)("rejects %s", (_name, invalidAuthorization) => {
    expect(HotApplicationManifestSchema.safeParse({ ...manifest, ...invalidAuthorization }).success).toBe(false);
  });
});

describe("Theme Skin token values", () => {
  it.each([
    "\\75\\72\\6c(//evil.test/theme.css)",
    "@import url(//evil.test/theme.css)",
    "#ffffff; color:#ffffff",
    "#ffffff/* payload */",
    "var(--k-nex-color-accent)!important",
    "\"#ffffff\""
  ])("rejects lexical CSS escape: %s", (value) => {
    expect(ThemeSkinTokenValueSchema.safeParse(value).success).toBe(false);
  });

  it.each(["#ABC", "#ABCD", "#A1B2C3", "#A1B2C3D4", "120ms"])("accepts flagless CSS-valid literal: %s", (value) => {
    expect(ThemeSkinTokenValueSchema.safeParse(value).success).toBe(true);
  });

  it.each(["#ABCDE", "#A1B2C3D", "6px 6px 0 #111111"])("rejects invalid literal length or composition: %s", (value) => {
    expect(ThemeSkinTokenValueSchema.safeParse(value).success).toBe(false);
  });
});

describe("Extension install plan versions", () => {
  const plan = {
    schemaVersion: 1, planId: "plan-semver-1", operationId: "operation-semver-1", operation: "install", version: "1.0.0-rc.1+build.2",
    artifactDigest: `sha256:${"a".repeat(64)}`, expectedRevision: 0, approvalRequired: false, rollback: { available: false, reason: "not-requested" },
    deliveryClass: "platform-plugin", id: "module.sales", availability: { outcome: "maintenance-required", reasons: ["destructive-migration"] }
  } as const;

  it("uses exact SemVer for every planned release", () => {
    expect(ExtensionInstallPlanSchema.safeParse(plan).success).toBe(true);
    for (const version of ["1.0.0-01", "1.0.0-alpha..1", "1.0.0-.", "1.0.0+build..1"]) {
      expect(ExtensionInstallPlanSchema.safeParse({ ...plan, version }).success, version).toBe(false);
    }
  });
});

describe("Migration-free compatibility plans", () => {
  const plan = {
    schemaVersion: 1,
    plan: {
      planId: "schema-less-uninstall-13", applicationId: "customer-alpha", environment: "production",
      sourceCommit: "a".repeat(40), targetSourceCommit: "b".repeat(40), baseRevision: 12, targetRevision: 12, steps: [],
      rollbackWindow: { state: "open", windowId: "schema-less-uninstall-13", previousApplicationDigest: `sha256:${"c".repeat(64)}`, closesAt: "2026-09-01T00:00:00.000Z", contractCleanup: "blocked" }
    }
  } as const;

  it("accepts an already-current database with no migration work", () => {
    expect(MigrationCompatibilityPlanSchema.safeParse(plan).success).toBe(true);
  });

  it.each([[12, 13], [13, 12]])("rejects empty migration work for revision change %i to %i", (baseRevision, targetRevision) => {
    expect(MigrationCompatibilityPlanSchema.safeParse({ ...plan, plan: { ...plan.plan, baseRevision, targetRevision } }).success).toBe(false);
  });

  const staticPlan = {
    schemaVersion: 1,
    planId: "static-schema-less-uninstall-13", applicationId: "customer-alpha", environment: "production", deliveryClass: "platform-plugin",
    plugin: { id: "provider.realtime.socketio", version: "1.0.0", releaseManifestDigest: `sha256:${"d".repeat(64)}` },
    authority: { identity: "github-app:k-nex-change-authority", requestDigest: `sha256:${"e".repeat(64)}` },
    base: { sourceCommit: "a".repeat(40), composition: { applicationManifestDigest: `sha256:${"1".repeat(64)}`, lockfileDigest: `sha256:${"2".repeat(64)}`, resolvedGraphDigest: `sha256:${"3".repeat(64)}`, generatedRegistriesDigest: `sha256:${"4".repeat(64)}`, packageClosureDigest: `sha256:${"5".repeat(64)}`, migrationPlanDigest: `sha256:${"6".repeat(64)}` } },
    target: { sourceCommit: "b".repeat(40), composition: { applicationManifestDigest: `sha256:${"7".repeat(64)}`, lockfileDigest: `sha256:${"8".repeat(64)}`, resolvedGraphDigest: `sha256:${"9".repeat(64)}`, generatedRegistriesDigest: `sha256:${"a".repeat(64)}`, packageClosureDigest: `sha256:${"b".repeat(64)}`, migrationPlanDigest: `sha256:${"c".repeat(64)}` }, applicationSubjectDigest: `sha256:${"d".repeat(64)}`, imageSubjectDigest: `sha256:${"e".repeat(64)}` },
    migration: plan.plan,
    status: "source-change-ready"
  } as const;

  it("keeps the migration-free revision invariant when embedded in a static composition plan", () => {
    expect(StaticCompositionChangePlanSchema.safeParse(staticPlan).success).toBe(true);
    for (const [baseRevision, targetRevision] of [[12, 13], [13, 12]]) {
      expect(StaticCompositionChangePlanSchema.safeParse({ ...staticPlan, migration: { ...staticPlan.migration, baseRevision, targetRevision } }).success).toBe(false);
    }
  });
});

describe("Static deployment receipts", () => {
  it("reports quarantine recovery promotion as immediately non-rollbackable", () => {
    const occurredAt = "2026-09-01T00:00:00.000Z";
    const parsed = StaticDeploymentReceiptSchema.parse({
      schemaVersion: 1,
      receiptId: "static-quarantine-recovery-1",
      operation: "promote",
      applicationId: "customer-alpha",
      environment: "production",
      activeGenerationId: "customer-alpha-green-12",
      previousGenerationId: "customer-alpha-blue-11",
      sourceCommit: "a".repeat(40),
      compositionChangePlanDigest: `sha256:${"b".repeat(64)}`,
      buildEvidenceDigest: `sha256:${"c".repeat(64)}`,
      applicationDigest: `sha256:${"d".repeat(64)}`,
      imageDigest: `sha256:${"e".repeat(64)}`,
      migrationRevision: 12,
      workerFencingToken: 2,
      promotionRevision: 1,
      revisionBefore: 0,
      revisionAfter: 1,
      rollbackWindow: { state: "closed", windowId: "quarantine-recovery-window-1", closedAt: occurredAt },
      contractCleanup: "blocked",
      occurredAt
    });

    expect(parsed.rollbackWindow.state).toBe("closed");
  });
});
