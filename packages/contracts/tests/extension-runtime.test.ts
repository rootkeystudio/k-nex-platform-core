import { describe, expect, it } from "vitest";

import { HotApplicationManifestSchema, hotApplicationOwnsRoute, matchHotApplicationRoute } from "../src/extension-runtime.js";

const manifest = {
  schemaVersion: 1, deliveryClass: "hot-application", id: "app.foo.bar", displayName: "Dotted routes", version: "1.0.0", runtimeAbi: "1.0.0",
  entrypoints: { server: [], ui: ["ui/main.mjs"] }, capabilities: [],
  resourceBudget: { maxBundleBytes: 1, maxAssetBytes: 1, maxStorageBytes: 1, maxMemoryMiB: 1, maxCpuMilliCores: 1, maxWallTimeMs: 1, maxInputBytes: 1, maxOutputBytes: 1, maxLogBytes: 1, maxConcurrency: 1 },
  settings: [], screens: [{ id: "foo.task", route: "/apps/foo.bar/tasks/:taskid", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: [], localization: [], healthChecks: []
} as const;

describe("Hot Application routes", () => {
  it("keeps the manifest owner exact and supports one-segment parameters", () => {
    expect(HotApplicationManifestSchema.parse(manifest).id).toBe("app.foo.bar");
    expect(HotApplicationManifestSchema.safeParse({ ...manifest, screens: [{ ...manifest.screens[0], route: "/apps/foo-bar/tasks/:taskid" }] }).success).toBe(false);
    expect(HotApplicationManifestSchema.safeParse({ ...manifest, id: "app.sales", screens: [{ ...manifest.screens[0], route: "/apps/sales-assistant" }] }).success).toBe(false);
    expect(hotApplicationOwnsRoute("app.sales", "/apps/sales-assistant")).toBe(false);
    expect(matchHotApplicationRoute("/apps/foo.bar/tasks/:taskid", "/apps/foo.bar/tasks/42")).toBe(true);
    expect(matchHotApplicationRoute("/apps/foo.bar/tasks/:taskid", "/apps/foo.bar/tasks/42/other")).toBe(false);
    expect(matchHotApplicationRoute("/apps/foo.bar/tasks/:taskid", "/apps/foo.bar/tasks/../admin")).toBe(false);
    expect(matchHotApplicationRoute("/apps/foo.bar/tasks/:taskid", "/apps/foo.bar/tasks/%2e%2e")).toBe(false);
  });
});
