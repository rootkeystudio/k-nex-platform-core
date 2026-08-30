import { describe, expect, it } from "vitest";

import { HotApplicationManifestSchema } from "@k-nex/contracts";
import { resolveHotApplicationFixedRoute, resolveHotApplicationNavigation, resolveHotApplicationRoute, resolveHotApplicationSlot } from "../src/hot-application-surfaces.js";

const registration = {
  appId: "app.sales-assistant", generationId: "sales-generation-1", active: true,
  routes: ["/apps/sales-assistant", "/apps/sales-assistant/tasks"],
  navigation: [{ id: "sales.assistant", title: "Sales assistant", route: "/apps/sales-assistant" }],
  slots: [{ slotId: "sales.task-detail", contributionId: "sales.assistant-summary" }]
};

const dottedManifest = {
  schemaVersion: 1, deliveryClass: "hot-application", id: "app.foo.bar", displayName: "Dotted routes", version: "1.0.0", runtimeAbi: "1.0.0",
  entrypoints: { server: [], ui: ["ui/main.mjs"] }, capabilities: [],
  resourceBudget: { maxBundleBytes: 1, maxAssetBytes: 1, maxStorageBytes: 1, maxMemoryMiB: 1, maxCpuMilliCores: 1, maxWallTimeMs: 1, maxInputBytes: 1, maxOutputBytes: 1, maxLogBytes: 1, maxConcurrency: 1 },
  settings: [], screens: [
    { id: "foo.home", route: "/apps/foo.bar", entrypoint: "ui/main.mjs" },
    { id: "foo.task", route: "/apps/foo.bar/tasks/:taskid", entrypoint: "ui/main.mjs" }
  ],
  navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: [], localization: [], healthChecks: []
} as const;

describe("fixed Hot Application surfaces", () => {
  it("resolves active routes, navigation, and extension slots without runtime route injection", () => {
    expect(resolveHotApplicationRoute("/apps/sales-assistant", [registration])).toEqual({ appId: registration.appId, generationId: registration.generationId, route: "/apps/sales-assistant" });
    expect(resolveHotApplicationNavigation([registration])).toEqual([{ appId: registration.appId, ...registration.navigation[0] }]);
    expect(resolveHotApplicationSlot("sales.task-detail", [registration])).toEqual([{ appId: registration.appId, generationId: registration.generationId, contributionId: "sales.assistant-summary" }]);
    expect(resolveHotApplicationFixedRoute("sales-assistant", ["tasks"], [registration])).toEqual({ appId: registration.appId, generationId: registration.generationId, route: "/apps/sales-assistant/tasks" });
  });

  it("rejects traversal, inactive routes, and ambiguous ownership", () => {
    expect(() => resolveHotApplicationRoute("/apps/sales-assistant/../admin", [registration])).toThrow();
    expect(() => resolveHotApplicationRoute("/apps/sales-assistant", [{ ...registration, active: false }])).toThrow();
    expect(() => resolveHotApplicationRoute("/apps/sales-assistant", [registration, { ...registration, appId: "app.other" }])).toThrow();
    expect(() => resolveHotApplicationFixedRoute("sales-assistant", ["%2e%2e"], [registration])).toThrow();
  });

  it("keeps dotted application IDs distinct from hyphenated IDs", () => {
    const manifest = HotApplicationManifestSchema.parse(dottedManifest);
    const dotted = {
      ...registration, appId: manifest.id, routes: manifest.screens.map(({ route }) => route),
      navigation: [{ id: "foo.bar", title: "Dotted", route: "/apps/foo.bar" }]
    };
    const hyphenated = {
      ...registration, appId: "app.foo-bar", routes: ["/apps/foo-bar"],
      navigation: [{ id: "foo-bar", title: "Hyphenated", route: "/apps/foo-bar" }]
    };

    expect(resolveHotApplicationRoute("/apps/foo.bar", [dotted, hyphenated]).appId).toBe("app.foo.bar");
    expect(resolveHotApplicationRoute("/apps/foo.bar/tasks/42", [dotted]).route).toBe("/apps/foo.bar/tasks/42");
    expect(resolveHotApplicationFixedRoute("foo.bar", undefined, [dotted, hyphenated]).appId).toBe("app.foo.bar");
    expect(resolveHotApplicationFixedRoute("foo-bar", undefined, [dotted, hyphenated]).appId).toBe("app.foo-bar");
    expect(() => resolveHotApplicationRoute("/apps/foo.bar/tasks/..", [dotted])).toThrow();
    expect(() => resolveHotApplicationRoute("/apps/foo.bar/tasks/%2e%2e", [dotted])).toThrow();
  });

  it("rejects routes that only share an application ID prefix", () => {
    const prefixCollision = {
      ...registration, appId: "app.sales", routes: ["/apps/sales-assistant"],
      navigation: [{ id: "sales", title: "Sales", route: "/apps/sales-assistant" }]
    };

    expect(() => resolveHotApplicationRoute("/apps/sales-assistant", [prefixCollision])).toThrow("Hot Application surface registration is invalid.");
  });
});
