import { describe, expect, it } from "vitest";

import { HotApplicationConcreteRouteSchema, HotApplicationManifestSchema, ThemeSkinTokenValueSchema, hotApplicationHostRouteTemplate, matchHotApplicationRoute } from "../src/extension-runtime.js";

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
