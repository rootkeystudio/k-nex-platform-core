import { describe, expect, it } from "vitest";

import type { RuntimeExtensionInventory, ThemeProfile } from "@k-nex/contracts";

import { projectSystemThemeAdministration } from "../src/system-theme-administration.js";
import type { ExtensionCatalogRecord } from "../src/extension-operator-api.js";

const digest = `sha256:${"a".repeat(64)}`;
const profile = (id: string, state: "draft" | "published", themeId = "theme.default"): ThemeProfile => ({
  schemaVersion: 1,
  id: "profile.admin",
  surface: "admin",
  themeId,
  themeVersion: "1.0.0",
  palette: "default",
  mode: "light",
  values: {},
  revision: { id, number: id.endsWith("2") ? 2 : 1, state, createdAt: "2026-09-02T00:00:00.000Z", ...(state === "published" ? { publishedAt: "2026-09-02T00:00:00.000Z" } : {}) }
});

const generation = { applicationId: "customer-alpha", environment: "production", deliveryClass: "theme-skin" as const, extensionId: "skin.minimal", generationId: "generation-skin-1", version: "1.0.0" };
const inventory = {
  schemaVersion: 1,
  applicationId: "customer-alpha",
  environment: "production",
  hostInventoryDigest: digest,
  revision: 2,
  observedAt: "2026-09-02T00:00:00.000Z",
  stateDigest: digest,
  extensions: { platformPlugins: {}, hotApplications: {}, themeSkins: {
    "skin.minimal": { disposition: "active", revision: 2, activeGeneration: generation, lastOperationId: "operation-skin-1", lastReceiptId: "receipt-skin-1", stateDigest: digest }
  } }
} as RuntimeExtensionInventory;
const catalog = [{
  extension: { deliveryClass: "theme-skin", id: "skin.minimal" }, version: "1.0.0", displayName: "Minimal", availability: "live-generation",
  revoked: false, review: "approved", security: "clear", support: "supported"
}] as readonly ExtensionCatalogRecord[];

describe("system theme administration projection", () => {
  it("keeps Package, Skin, and Profile classes distinct and blocks referenced package removal", () => {
    const view = projectSystemThemeAdministration({
      packages: [
        { id: "theme.unused", version: "1.0.0", displayName: "Unused", surfaces: ["public"], availability: "available" },
        { id: "theme.default", version: "1.0.0", displayName: "Default", surfaces: ["admin", "public"], availability: "installed" }
      ],
      profiles: [{ profileId: "profile.admin", revision: 2, active: profile("revision-1", "published"), draft: profile("revision-2", "draft") }],
      inventory,
      catalog
    });

    expect(view.packages.map((item) => item.class)).toEqual(["package", "package"]);
    expect(view.skins).toEqual([expect.objectContaining({ class: "skin", id: "skin.minimal", disposition: "active", generationId: "generation-skin-1" })]);
    expect(view.profiles).toEqual([expect.objectContaining({ class: "profile", profileId: "profile.admin" })]);
    expect(view.packages.find((item) => item.id === "theme.default")).toMatchObject({
      removal: "blocked",
      references: [
        { profileId: "profile.admin", state: "active", profileRevisionId: "revision-1" },
        { profileId: "profile.admin", state: "draft", profileRevisionId: "revision-2" }
      ]
    });
    expect(view.packages.find((item) => item.id === "theme.unused")).toMatchObject({ removal: "available", references: [] });
  });

  it("rejects a non-theme package before projection", () => {
    expect(() => projectSystemThemeAdministration({
      packages: [{ id: "module.sales", version: "1.0.0", displayName: "Wrong", surfaces: ["admin"], availability: "installed" }],
      profiles: [], inventory, catalog
    })).toThrow("Theme Package administration descriptor is invalid");
  });
});
