import { describe, expect, it } from "vitest";

import {
  PluginContributionDeclarationSchema,
  PluginManifestSchema,
  pluginContributionCategoryKeys,
  pluginContributionNamespace,
  pluginContributionRegistry
} from "../src/index.js";

const manifest = {
  apiVersion: 1,
  id: "module.sales",
  kind: "module",
  displayName: "Sales",
  version: "1.0.0",
  package: "@k-nex/module-sales",
  compatibility: { core: "1", payload: "3", node: "24", payloadDatabaseAdapters: ["postgres"] },
  lifecycle: { ownsPayloadSchema: false, ownsPersistentData: true, disable: "supported", purge: "unsupported", uninstall: "unsupported" }
} as const;

describe("P6.1 plugin contribution taxonomy", () => {
  it("exposes every canonical category with its registration metadata", () => {
    expect(pluginContributionCategoryKeys).toHaveLength(20);
    expect(Object.keys(pluginContributionRegistry)).toEqual(pluginContributionCategoryKeys);
    for (const metadata of Object.values(pluginContributionRegistry)) {
      expect(metadata.registrationPhase).toBeTruthy();
      expect(metadata.authority).toBeTruthy();
    }
  });

  it("accepts a static required or optional ID map for every category", () => {
    const contributions = Object.fromEntries(pluginContributionCategoryKeys.map((category, index) => [
      category,
      { [`sales.contribution-${index}`]: category === "schema" ? "required" : "optional" }
    ]));
    expect(PluginManifestSchema.safeParse({ ...manifest, contributions }).success).toBe(true);
  });

  it("rejects empty, unknown, legacy, and invalid declaration maps", () => {
    expect(PluginContributionDeclarationSchema.safeParse({}).success).toBe(false);
    expect(PluginContributionDeclarationSchema.safeParse({ sales: "required" }).success).toBe(false);
    expect(PluginManifestSchema.safeParse({
      ...manifest,
      contributions: { dataSources: { "sales.tasks": "required" } }
    }).success).toBe(false);
    expect(PluginManifestSchema.safeParse({
      ...manifest,
      contributions: { notACategory: { "sales.tasks": "required" } }
    }).success).toBe(false);
  });

  it("enforces the first semantic plugin namespace, including multi-segment plugin IDs", () => {
    expect(pluginContributionNamespace("module.sales")).toBe("sales");
    expect(pluginContributionNamespace("provider.realtime.socketio")).toBe("realtime");
    expect(PluginManifestSchema.safeParse({
      ...manifest,
      contributions: { tools: { "other.search": "required" } }
    }).success).toBe(false);
    expect(PluginManifestSchema.safeParse({
      ...manifest,
      id: "provider.realtime.socketio",
      kind: "provider",
      contributions: { realtimeTopics: { "realtime.socketio.presence": "required" } }
    }).success).toBe(true);
  });

  it("keeps lifecycle contribution IDs separate from top-level lifecycle policy", () => {
    expect(PluginManifestSchema.safeParse({
      ...manifest,
      contributions: { lifecycle: { "sales.lifecycle.install": "required" } }
    }).success).toBe(true);
  });
});
