import { describe, expect, it, vi } from "vitest";
import { sha256 } from "@k-nex/extension-bundler";

import {
  PostgresSystemSettingsDescriptorSource,
  createVerifiedHotApplicationSettingsDescriptorResolver
} from "../src/system-settings-descriptor-source.js";

function descriptor(
  id: string,
  publisher: Readonly<{ kind: "platform"; namespace: "system" }> | Readonly<{ kind: "extension"; deliveryClass: "platform-plugin" | "hot-application"; extensionId: string }>,
  descriptorSchemaVersion = 1
) {
  const namespace = id.slice(0, id.indexOf("."));
  return {
    schemaVersion: 1 as const,
    id,
    publisher,
    descriptorSchemaVersion,
    validation: publisher.kind === "extension" && publisher.deliveryClass === "hot-application" ? "generation-validated" as const : "immediate" as const,
    fields: { enabled: { type: "boolean" as const, required: true, default: true } },
    readPermission: `${namespace}.settings.read`,
    changePermission: `${namespace}.settings.manage`
  };
}

const platform = descriptor("system.settings.runtime", { kind: "platform", namespace: "system" });
const sales = descriptor("sales.settings.workspace", { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" });
const weather = descriptor("weather.settings.runtime", { kind: "extension", deliveryClass: "hot-application", extensionId: "app.weather" });
const legacy = descriptor("legacy.settings.runtime", { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.legacy" }, 2);

function verifiedHotArtifact() {
  const path = "schemas/settings.json";
  const bytes = Buffer.from(JSON.stringify(weather));
  const artifactDigest = `sha256:${"a".repeat(64)}` as const;
  return {
    artifactDigest,
    catalogDigest: `sha256:${"b".repeat(64)}`,
    verified: {
      artifactDigest,
      manifest: { deliveryClass: "hot-application", id: "app.weather", files: { [path]: { digest: sha256(bytes), bytes: bytes.byteLength, contentType: "application/json" } } },
      hotApplicationManifest: {
        schemaVersion: 1, deliveryClass: "hot-application", id: "app.weather", displayName: "Weather", version: "1.0.0", runtimeAbi: "1.0.0",
        entrypoints: { server: [], ui: ["ui/main.mjs"] }, capabilities: [], permissions: [], policyBindings: [],
        resourceBudget: { maxBundleBytes: 1024, maxAssetBytes: 1024, maxStorageBytes: 1024, maxMemoryMiB: 64, maxCpuMilliCores: 100, maxWallTimeMs: 1_000, maxInputBytes: 1024, maxOutputBytes: 1024, maxLogBytes: 1024, maxConcurrency: 1 },
        settings: [{ id: weather.id, path }], screens: [{ id: "weather.screen", route: "/", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: [], localization: [], healthChecks: []
      },
      files: new Map([[path, bytes]])
    }
  } as any;
}

describe("PostgresSystemSettingsDescriptorSource", () => {
  it("exposes an exact waiting Hot Application generation before activation", async () => {
    const query = vi.fn(async (text: string) => text.includes("from k_nex_extension_authorization_generations") ? { rows: [
      { delivery_class: "hot-application", extension_id: "app.weather", authorization_generation: 2,
        runtime_generation_ids: ["weather-runtime-2"], state: "pending-configuration", disposition: "removed",
        active_generation_id: null, retained_generation: null, operation_phase: "waiting-configuration" }
    ] } : { rows: [] });
    const source = new PostgresSystemSettingsDescriptorSource({ query } as never, {
      platformPlugins: { resolve: () => [] }, hotApplications: { resolve: () => [weather] }
    });

    await expect(source.list("customer-alpha", "production")).resolves.toEqual([
      expect.objectContaining({ lifecycle: "pending-configuration", identity: expect.objectContaining({ owner: expect.objectContaining({ generation: 2 }) }) })
    ]);
  });

  it("binds platform, active, disabled, and document-backed retired definitions without reading values", async () => {
    const query = vi.fn(async (text: string) => text.includes("from k_nex_extension_authorization_generations") ? { rows: [
      { delivery_class: "platform-plugin", extension_id: "module.sales", authorization_generation: "2", runtime_generation_ids: ["sales-runtime-2"], state: "current", disposition: "active", active_generation_id: "sales-runtime-2", retained_generation: null },
      { delivery_class: "hot-application", extension_id: "app.weather", authorization_generation: 1, runtime_generation_ids: ["weather-runtime-1"], state: "current", disposition: "disabled", active_generation_id: null, retained_generation: { generationId: "weather-runtime-1" } },
      { delivery_class: "platform-plugin", extension_id: "module.legacy", authorization_generation: 1, runtime_generation_ids: ["legacy-runtime-1"], state: "retired", disposition: "removed", active_generation_id: null, retained_generation: null }
    ] } : { rows: [
      { descriptor_id: legacy.id, descriptor_schema_version: 2, owner_delivery_class: "platform-plugin", owner_extension_id: "module.legacy", owner_generation: 1 }
    ] });
    const platformPlugins = { resolve: vi.fn((input) => input.extensionId === "module.sales" ? [sales] : [legacy]) };
    const hotApplications = { resolve: vi.fn(() => [weather]) };
    const source = new PostgresSystemSettingsDescriptorSource({ query } as never, {
      platformDescriptors: [platform], platformPlugins, hotApplications
    });

    await expect(source.list("customer-alpha", "production")).resolves.toEqual([
      expect.objectContaining({ descriptor: legacy, lifecycle: "retired", identity: expect.objectContaining({ owner: expect.objectContaining({ generation: 1 }) }) }),
      expect.objectContaining({ descriptor: sales, lifecycle: "active", identity: expect.objectContaining({ owner: expect.objectContaining({ generation: 2 }) }) }),
      expect.objectContaining({ descriptor: platform, lifecycle: "active", identity: expect.objectContaining({ owner: { kind: "platform", namespace: "system" } }) }),
      expect.objectContaining({ descriptor: weather, lifecycle: "disabled", identity: expect.objectContaining({ owner: expect.objectContaining({ generation: 1 }) }) })
    ]);
    expect(platformPlugins.resolve).toHaveBeenCalledWith(expect.objectContaining({ runtimeGenerationId: "sales-runtime-2" }));
    expect(hotApplications.resolve).toHaveBeenCalledWith(expect.objectContaining({ runtimeGenerationId: "weather-runtime-1" }));
    expect(query.mock.calls.every(([text]) => !String(text).includes("values_json"))).toBe(true);
  });

  it("lets a current reinstall shadow an older document with the same descriptor ID", async () => {
    const oldSales = { ...sales, descriptorSchemaVersion: 1 };
    const newSales = { ...sales, descriptorSchemaVersion: 2 };
    const query = vi.fn(async (text: string) => text.includes("from k_nex_extension_authorization_generations") ? { rows: [
      { delivery_class: "platform-plugin", extension_id: "module.sales", authorization_generation: 2, runtime_generation_ids: ["sales-runtime-2"], state: "current", disposition: "active", active_generation_id: "sales-runtime-2", retained_generation: null },
      { delivery_class: "platform-plugin", extension_id: "module.sales", authorization_generation: 1, runtime_generation_ids: ["sales-runtime-1"], state: "retired", disposition: "active", active_generation_id: "sales-runtime-2", retained_generation: null }
    ] } : { rows: [
      { descriptor_id: sales.id, descriptor_schema_version: 1, owner_delivery_class: "platform-plugin", owner_extension_id: "module.sales", owner_generation: 1 }
    ] });
    const source = new PostgresSystemSettingsDescriptorSource({ query } as never, {
      platformPlugins: { resolve: ({ runtimeGenerationId }) => runtimeGenerationId.endsWith("2") ? [newSales] : [oldSales] },
      hotApplications: { resolve: () => [] }
    });

    const result = await source.list("customer-alpha", "production");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ descriptor: { descriptorSchemaVersion: 2 }, lifecycle: "active", identity: { owner: { generation: 2 } } });
  });

  it("fails closed when a current authorization generation is not the active or retained runtime generation", async () => {
    const query = vi.fn(async (text: string) => text.includes("from k_nex_extension_authorization_generations") ? { rows: [
      { delivery_class: "hot-application", extension_id: "app.weather", authorization_generation: 1, runtime_generation_ids: ["weather-runtime-1"], state: "current", disposition: "active", active_generation_id: "forged-runtime", retained_generation: null }
    ] } : { rows: [] });
    const source = new PostgresSystemSettingsDescriptorSource({ query } as never, {
      platformPlugins: { resolve: () => [] }, hotApplications: { resolve: () => [weather] }
    });

    await expect(source.list("customer-alpha", "production")).rejects.toThrow("does not match runtime lifecycle");
  });

  it("rejects a settings ID collision across distinct extension owners", async () => {
    const hotSales = descriptor("sales.settings.workspace", { kind: "extension", deliveryClass: "hot-application", extensionId: "app.sales" });
    const query = vi.fn(async (text: string) => text.includes("from k_nex_extension_authorization_generations") ? { rows: [
      { delivery_class: "platform-plugin", extension_id: "module.sales", authorization_generation: 1, runtime_generation_ids: ["sales-plugin-runtime"], state: "current", disposition: "active", active_generation_id: "sales-plugin-runtime", retained_generation: null },
      { delivery_class: "hot-application", extension_id: "app.sales", authorization_generation: 1, runtime_generation_ids: ["sales-app-runtime"], state: "current", disposition: "active", active_generation_id: "sales-app-runtime", retained_generation: null }
    ] } : { rows: [] });
    const source = new PostgresSystemSettingsDescriptorSource({ query } as never, {
      platformPlugins: { resolve: () => [sales] }, hotApplications: { resolve: () => [hotSales] }
    });

    await expect(source.list("customer-alpha", "production")).rejects.toThrow("ambiguous across owners");
  });

  it("resolves Hot Application schemas from exact reverified generation bytes", async () => {
    const readSettingsDescriptorGeneration = vi.fn(async () => verifiedHotArtifact());
    const resolver = createVerifiedHotApplicationSettingsDescriptorResolver({ readSettingsDescriptorGeneration });

    await expect(resolver.resolve({
      applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application",
      extensionId: "app.weather", runtimeGenerationId: "weather-runtime-1"
    })).resolves.toEqual([weather]);
    expect(readSettingsDescriptorGeneration).toHaveBeenCalledWith({
      applicationId: "customer-alpha", environment: "production", extensionId: "app.weather", generationId: "weather-runtime-1"
    });

    await expect(createVerifiedHotApplicationSettingsDescriptorResolver({
      readSettingsDescriptorGeneration: async () => undefined
    }).resolve({
      applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application",
      extensionId: "app.weather", runtimeGenerationId: "weather-runtime-1"
    })).rejects.toThrow("unavailable");
  });
});
