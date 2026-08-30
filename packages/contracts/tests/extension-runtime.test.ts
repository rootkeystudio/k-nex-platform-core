import { describe, expect, it } from "vitest";

import { HotApplicationConcreteRouteSchema, HotApplicationManifestSchema, hotApplicationHostRouteTemplate, matchHotApplicationRoute } from "../src/extension-runtime.js";

const manifest = {
  schemaVersion: 1, deliveryClass: "hot-application", id: "app.foo.bar", displayName: "Dotted routes", version: "1.0.0", runtimeAbi: "1.0.0",
  entrypoints: { server: [], ui: ["ui/main.mjs"] }, capabilities: [],
  resourceBudget: { maxBundleBytes: 1, maxAssetBytes: 1, maxStorageBytes: 1, maxMemoryMiB: 1, maxCpuMilliCores: 1, maxWallTimeMs: 1, maxInputBytes: 1, maxOutputBytes: 1, maxLogBytes: 1, maxConcurrency: 1 },
  settings: [], screens: [{ id: "foo.task", route: "/tasks/:taskid", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: [], localization: [], healthChecks: []
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
