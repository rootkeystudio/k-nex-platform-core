import { describe, expect, it, vi } from "vitest";

import type { RuntimeExtensionInventory, ThemeProfile } from "@k-nex/contracts";

import { CurrentAuthorityAdapter } from "../src/current-authority-adapter.js";
import { createTrustedAuthorizationSession, type EffectiveAuthorizationRequest, type TrustedAuthorizationSession } from "../src/effective-authority.js";
import { projectSystemThemeAdministration, SystemThemeAdministrationService } from "../src/system-theme-administration.js";
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

const authorityState = { applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 7 };
const session = createTrustedAuthorizationSession({
  schemaVersion: 1, applicationId: authorityState.applicationId, environment: authorityState.environment,
  correlationId: "system-theme-test", principal: { kind: "user", id: "admin" }, effectiveActor: { kind: "user", id: "admin" }
});

function themeDecision(request: EffectiveAuthorizationRequest, current: TrustedAuthorizationSession, outcome: "allow" | "deny" = "allow") {
  return {
    schemaVersion: 1 as const, decisionId: request.decisionId, correlationId: current.correlationId,
    applicationId: current.applicationId, environment: current.environment, permissionId: request.permissionId,
    owner: { kind: "platform" as const, namespace: "system" }, principal: current.principal, effectiveActor: current.effectiveActor,
    scope: request.scope, authorizationRevision: authorityState.authorizationRevision, lifecycleRevision: authorityState.lifecycleRevision,
    outcome, reason: outcome === "allow" ? "granted" as const : "permission-not-granted" as const,
    approval: "not-required" as const, reauthentication: "not-required" as const
  };
}

function serviceHarness(outcome: "allow" | "deny" | (() => "allow" | "deny") = "allow") {
  const resolver = { authorize: vi.fn(async (current: TrustedAuthorizationSession, request: EffectiveAuthorizationRequest) => themeDecision(request, current, typeof outcome === "function" ? outcome() : outcome)) };
  const profiles = {
    list: vi.fn(async () => []), read: vi.fn(async () => undefined), preview: vi.fn(async () => ({ valid: true })),
    stageDraft: vi.fn(async () => ({ profileId: "profile.admin", revision: 1 })), publish: vi.fn(async () => ({ published: true })), rollback: vi.fn(async () => ({ rolledBack: true }))
  };
  const provider = { resolve: vi.fn(() => profiles) };
  const source = { read: vi.fn(async () => ({ packages: [], inventory, catalog })) };
  const state = { readState: vi.fn(async () => ({ schemaVersion: 1 as const, ...authorityState, inventoryRevision: 2, extensionRevision: 2 })) };
  const authority = new CurrentAuthorityAdapter({ current: async () => session }, resolver as never);
  return { resolver, profiles, provider, source, state, service: new SystemThemeAdministrationService({ authority, state, profiles: provider, catalog: source }) };
}

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

  it("projects the highest exact-semver skin release", () => {
    const releases = [catalog[0]!, { ...catalog[0]!, version: "1.0.10" }, { ...catalog[0]!, version: "1.0.9" }];
    const emptyInventory = { ...inventory, extensions: { ...inventory.extensions, themeSkins: {} } } as RuntimeExtensionInventory;
    expect(projectSystemThemeAdministration({ packages: [], profiles: [], inventory: emptyInventory, catalog: releases }).skins[0]).toMatchObject({ version: "1.0.10" });
  });
});

describe("system theme administration service", () => {
  it("denies before profile or catalog authority is touched", async () => {
    const value = serviceHarness("deny");
    await expect(value.service.list({ context: {} })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(value.provider.resolve).not.toHaveBeenCalled();
    expect(value.source.read).not.toHaveBeenCalled();
  });

  it("derives the fixed read permission and reauthorizes the projection", async () => {
    const value = serviceHarness();
    await expect(value.service.list({ context: {} })).resolves.toMatchObject({ packages: [], profiles: [] });
    expect(value.resolver.authorize).toHaveBeenCalledTimes(2);
    expect(value.resolver.authorize.mock.calls[0]?.[1]).toMatchObject({ permissionId: "system.themes.read", scope: { kind: "application", resource: "system.themes" } });
    expect(value.profiles.list).toHaveBeenCalledWith({ applicationId: authorityState.applicationId, environment: authorityState.environment });
  });

  it("derives manage authority and rejects client authority fields", async () => {
    const value = serviceHarness();
    await expect(value.service.preview({ context: {}, profile: profile("revision-2", "draft"), expectedRevision: 1 })).resolves.toEqual({ valid: true });
    expect(value.resolver.authorize.mock.calls[0]?.[1]).toMatchObject({ permissionId: "system.themes.manage" });
    expect(value.profiles.preview).toHaveBeenCalledWith(expect.objectContaining({ applicationId: authorityState.applicationId, environment: authorityState.environment, expectedRevision: 1 }));
    await expect(value.service.preview({ context: {}, profile: {}, expectedRevision: 1, permissionId: "system.themes.manage" } as never)).rejects.toMatchObject({ code: "REQUEST_INVALID" });
  });

  it("rechecks current authority after resolving the operator and before mutation", async () => {
    let calls = 0;
    const value = serviceHarness(() => ++calls === 1 ? "allow" : "deny");
    await expect(value.service.publish({ context: {}, profile: profile("revision-2", "draft"), expectedRevision: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(value.profiles.publish).not.toHaveBeenCalled();
  });
});
