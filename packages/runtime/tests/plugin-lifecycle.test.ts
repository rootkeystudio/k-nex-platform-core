import { describe, expect, it } from "vitest";
import type { PluginManifest } from "@k-nex/contracts";
import {
  assertExecutableRegistrationAuthority,
  assertPluginDestructiveOperationSafe,
  assertPluginUninstallSupported,
  createPluginLifecycleState,
  disablePlugin,
  planPluginInstall,
  pluginReadyForEnable,
  reenablePlugin,
  reconcilePluginAvailability,
  scopePluginRegistration,
  scanPluginReferences,
  type RegistrationResult
} from "../src/index.js";

const integrity = `sha512-${"a".repeat(86)}==`;
const manifest = {
  apiVersion: 1, id: "module.sales", kind: "module", displayName: "Sales", version: "1.0.0", package: "@k-nex/module-sales",
  compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
  provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"],
  lifecycle: { ownsPayloadSchema: true, ownsPersistentData: true, disable: "supported", uninstall: "unsupported", purge: "supported" },
  contributions: { schema: { "sales.tasks.collection": "required" }, actions: { "sales.task.create": "required" }, pageTemplates: { "sales.page.tasks": "required" } }
} as const satisfies PluginManifest;

function state(overrides = {}) {
  return createPluginLifecycleState({
    pluginId: "module.sales", catalogStatus: "supported",
    package: { status: "installed", name: "@k-nex/module-sales", version: "1.0.0", integrity },
    enabled: true, configuration: { revision: 1, ready: true }, migration: { current: 6, required: 6, ready: true },
    dataState: "active", releaseStatus: "supported", ...overrides
  });
}

const empty = () => [];
const registration = {
  phases: [], inventory: [],
  contributions: {
    schema: [{ pluginId: "module.sales", id: "sales.tasks.collection", value: {} }],
    migrations: [], services: [], permissions: [], settings: [], sources: [],
    actions: [{ pluginId: "module.sales", id: "sales.task.create", value: {} }], tools: [], events: [],
    jobs: [{ pluginId: "module.sales", id: "sales.job.audit", value: () => "ran" }], realtimeTopics: [],
    components: [], blocks: [{ pluginId: "module.sales", id: "sales.block.tasks", value: {} }],
    routes: [{ pluginId: "module.sales", id: "sales.route.tasks", value: {} }], navigation: [], pageTemplates: [],
    localization: [], healthAudit: [], lifecycle: [{ pluginId: "module.sales", id: "sales.lifecycle.reference", value: {} }], testingMetadata: []
  },
  bindings: {
    sources: empty(),
    actions: [{ pluginId: "module.sales", id: "sales.task.create", value: () => "ran" }],
    components: empty(),
    blocks: [{ pluginId: "module.sales", id: "sales.block.tasks", value: () => "rendered" }]
  }
} as unknown as RegistrationResult;

describe("plugin lifecycle", () => {
  it("rejects every registration until authoritative lifecycle scoping", () => {
    const raw = { ...registration, contributions: { ...registration.contributions, lifecycle: [] } } as unknown as RegistrationResult;
    expect(() => assertExecutableRegistrationAuthority(raw)).toThrow(/authoritative lifecycle scoping/);
    expect(() => assertExecutableRegistrationAuthority(scopePluginRegistration(raw, []))).not.toThrow();
  });

  it("plans source-controlled install and idempotent customer-owned template seeding", () => {
    const first = planPluginInstall({ manifest, package: { name: manifest.package, version: manifest.version, integrity } });
    expect(first).toEqual({ operation: "install", packageChange: { name: manifest.package, version: manifest.version, integrity }, requiresDeployment: true, seedTemplateIds: ["sales.page.tasks"] });
    expect(planPluginInstall({ manifest, package: { name: manifest.package, version: manifest.version, integrity }, state: state(), existingTemplateIds: ["sales.page.tasks"] })).toMatchObject({ operation: "noop", packageChange: null, seedTemplateIds: [] });
  });

  it("disables behavior while retaining schema and restores it only when ready", () => {
    const disabled = disablePlugin(state(), manifest);
    expect(disabled).toMatchObject({ enabled: false, dataState: "retained" });
    const availability = reconcilePluginAvailability(registration, disabled);
    expect(availability.isAvailable("schema", "sales.tasks.collection")).toBe(true);
    expect(availability.isAvailable("actions", "sales.task.create")).toBe(false);
    const scoped = scopePluginRegistration(registration, [availability]);
    expect(() => scopePluginRegistration(registration, [{ ...availability }])).toThrow(/not authoritative/);
    expect(scoped.contributions.schema).toHaveLength(1);
    expect(scoped.contributions.actions).toEqual([]);
    expect(scoped.contributions.jobs).toEqual([]);
    expect(scoped.contributions.routes).toEqual([]);
    expect(scoped.bindings.actions).toEqual([]);
    expect(scoped.bindings.blocks).toEqual([]);
    expect(() => scopePluginRegistration(registration, [])).toThrow(/requires lifecycle availability/);
    expect(reenablePlugin(disabled, manifest)).toMatchObject({ enabled: true, dataState: "active" });
    const stale = createPluginLifecycleState({ ...disabled, migration: { current: 5, required: 6, ready: false } });
    expect(pluginReadyForEnable(stale)).toBe(false);
    expect(() => reenablePlugin(stale, manifest)).toThrow(/not ready/);
  });

  it("scans references deterministically and refuses unsafe destructive lifecycle", () => {
    const references = [
      { kind: "document", id: "page.sales", pluginId: "module.sales" },
      { kind: "dependency", id: "module.consumer", pluginId: "module.sales" },
      { kind: "document", id: "page.sales", pluginId: "module.sales" }
    ] as const;
    expect(scanPluginReferences("module.sales", references).map(({ id }) => id)).toEqual(["module.consumer", "page.sales"]);
    expect(() => assertPluginDestructiveOperationSafe(manifest, references)).toThrow(/2 active reference/);
    expect(() => assertPluginDestructiveOperationSafe(manifest, [])).not.toThrow();
    expect(() => assertPluginUninstallSupported(manifest)).toThrow(/does not support uninstall/);
  });
});
