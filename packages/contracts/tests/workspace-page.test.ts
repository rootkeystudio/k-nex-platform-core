import { describe, expect, it } from "vitest";

import {
  WorkspaceContractsSchema,
  WorkspaceNavigationTreeSchema,
  WorkspacePageAccessSnapshotSchema,
  WorkspacePageSchema,
  WorkspacePublishedRevisionSchema,
  WorkspaceShellSnapshotSchema,
  WorkspaceWorkingCopyChangeInputSchema,
  WorkspaceWorkingCopySchema,
  phase12AttackMap,
  pluginContributionCategoryKeys,
  workspacePagePermissionIds,
  workspaceRouteClasses
} from "../src/index.js";

const timestamp = "2026-09-03T08:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const identity = {
  applicationId: "customer-alpha",
  environment: "production",
  pageId: "workspace.page.sales-board",
  documentId: "workspace.document.sales-board"
} as const;
const document = {
  id: identity.documentId,
  version: 1,
  schemaVersion: 1,
  profile: "workspace",
  regions: { main: [{ id: "sales-board-title", type: "content.text", version: 1, props: { text: "Sales board" } }] }
} as const;
const systemRoot = { id: "system.navigation.root", owner: { kind: "platform" }, kind: "folder", label: "System", icon: "system", order: 100 } as const;
const salesRoot = { id: "sales.navigation.root", owner: { kind: "platform-plugin", pluginId: "module.sales" }, kind: "folder", label: "Sales", icon: "sales", order: 10 } as const;
const pageNode = { id: "workspace.navigation.sales-board", owner: { kind: "customer" }, kind: "link", parentId: salesRoot.id, label: "Sales board", order: 20, target: { class: "workspace-page", pageId: identity.pageId, mode: "view" } } as const;
const navigation = { schemaVersion: 1, applicationId: identity.applicationId, environment: identity.environment, revision: 1, nodes: [salesRoot, pageNode, systemRoot] } as const;

describe("P12.1 workspace contracts", () => {
  it("freezes the exact fixed route classes without browser-authored paths", () => {
    expect(workspaceRouteClasses).toEqual({
      system: "/system/*",
      hotApplication: "/apps/:appId/*",
      platformPlugin: "registered-static-plugin-route",
      workspacePage: "/workspace/pages/:pageId",
      workspacePageEditor: "/workspace/pages/:pageId/edit"
    });
    expect(Object.isFrozen(workspaceRouteClasses)).toBe(true);
    expect(workspacePagePermissionIds).toEqual([
      "system.workspace-pages.read",
      "system.workspace-pages.create",
      "system.workspace-pages.edit",
      "system.workspace-pages.publish",
      "system.workspace-pages.access.manage"
    ]);
    expect(pluginContributionCategoryKeys.filter((key) => ["blocks", "routes", "navigation"].includes(key))).toEqual(["blocks", "routes", "navigation"]);
    expect(pluginContributionCategoryKeys).not.toContain("workspacePages");
  });

  it("accepts one closed server-produced shell and rejects foreign navigation identity", () => {
    const shell = {
      schemaVersion: 1,
      applicationId: identity.applicationId,
      environment: identity.environment,
      applicationLabel: "Customer Alpha",
      location: pageNode.target,
      breadcrumbs: [{ label: "Sales", target: { class: "platform-plugin", ownerPluginId: "module.sales", routeId: "sales.workspace" } }],
      navigation,
      themeProfile: { profileId: "theme.profile.workspace", revisionId: "theme.profile.workspace.revision-one", surface: "admin" },
      authorizationRevision: 3,
      lifecycleRevision: 4,
      settingsRevision: 5
    } as const;
    expect(WorkspaceShellSnapshotSchema.safeParse(shell).success).toBe(true);
    expect(WorkspaceShellSnapshotSchema.safeParse({ ...shell, navigation: { ...navigation, applicationId: "customer-beta" } }).success).toBe(false);
    expect(WorkspaceShellSnapshotSchema.safeParse({ ...shell, pathname: "/forged" }).success).toBe(false);
  });

  it("rejects duplicate, cyclic, missing-parent, cross-owner, and System-shadowing navigation", () => {
    expect(WorkspaceNavigationTreeSchema.safeParse(navigation).success).toBe(true);
    const cases = [
      { ...navigation, nodes: [systemRoot, salesRoot, { ...pageNode, id: salesRoot.id }] },
      { ...navigation, nodes: [systemRoot, { ...salesRoot, parentId: pageNode.id }, pageNode] },
      { ...navigation, nodes: [systemRoot, salesRoot, { ...pageNode, parentId: "sales.navigation.missing" }] },
      { ...navigation, nodes: [systemRoot, salesRoot, { ...pageNode, target: { class: "platform-plugin", ownerPluginId: "module.sales", routeId: "sales.workspace" } }] },
      { ...navigation, nodes: [{ ...systemRoot, owner: { kind: "customer" } }, salesRoot, pageNode] },
      { ...navigation, nodes: [systemRoot, salesRoot, { ...pageNode, parentId: systemRoot.id }] }
    ];
    for (const value of cases) expect(WorkspaceNavigationTreeSchema.safeParse(value).success).toBe(false);
  });

  it("separates page ACL from platform and block data authority", () => {
    const access = { schemaVersion: 1, identity, accessRevision: 4, assignments: [{ subject: { kind: "role", roleId: "sales-manager" }, capability: "edit" }, { subject: { kind: "user", userId: "user:viewer" }, capability: "view" }] } as const;
    expect(WorkspacePageAccessSnapshotSchema.safeParse(access).success).toBe(true);
    expect(WorkspacePageAccessSnapshotSchema.safeParse({ ...access, permissionId: "sales.opportunities.read" }).success).toBe(false);
    expect(WorkspacePageAccessSnapshotSchema.safeParse({ ...access, assignments: [...access.assignments, access.assignments[0]] }).success).toBe(false);
    expect(WorkspacePageAccessSnapshotSchema.safeParse({ ...access, assignments: [{ subject: { kind: "service", id: "service:admin" }, capability: "edit" }] }).success).toBe(false);
  });

  it("binds mutable working copies and immutable publications to one page/document identity", () => {
    const working = { schemaVersion: 1, identity, revision: 1, document, editorSessionId: "editor-session-1", idempotencyKey: "workspace-save-1", updatedBy: { kind: "user", id: "user:owner" }, updatedAt: timestamp } as const;
    expect(WorkspaceWorkingCopySchema.safeParse(working).success).toBe(true);
    expect(WorkspaceWorkingCopySchema.safeParse({ ...working, document: { ...document, id: "workspace.document.forged" } }).success).toBe(false);
    expect(WorkspaceWorkingCopySchema.safeParse({ ...working, document: { ...document, profile: "cms" } }).success).toBe(false);
    const published = { schemaVersion: 1, revisionId: "workspace-publication-1", identity, documentRevision: 1, document, accessRevision: 4, dependencies: { entries: [{ kind: "block", id: "content.text", version: 1, owner: { kind: "platform" } }], digest: digest("a") }, publishedBy: working.updatedBy, publishedAt: timestamp } as const;
    expect(WorkspacePublishedRevisionSchema.safeParse(published).success).toBe(true);
    expect(WorkspacePublishedRevisionSchema.safeParse({ ...published, identity: { ...identity, documentId: "workspace.document.forged" } }).success).toBe(false);
  });

  it("keeps browser autosave input free of application, environment, ACL, route, and executable authority", () => {
    const input = { expectedRevision: 1, editorSessionId: "editor-session-1", idempotencyKey: "workspace-save-2", document: { ...document, version: 2 } } as const;
    expect(WorkspaceWorkingCopyChangeInputSchema.safeParse(input).success).toBe(true);
    for (const forged of [
      { applicationId: identity.applicationId }, { environment: identity.environment }, { pageId: identity.pageId },
      { permissionId: "system.workspace-pages.edit" }, { pathname: "/system" }, { javascript: "alert(1)" }
    ]) expect(WorkspaceWorkingCopyChangeInputSchema.safeParse({ ...input, ...forged }).success).toBe(false);
  });

  it("requires coherent page publication state and one canonical identity", () => {
    const base = { schemaVersion: 1, identity, title: "Sales board", state: "draft", navigation: { state: "placed", parentNavigationId: salesRoot.id, order: 20 }, workingCopyRevision: 1, accessRevision: 0, revision: 1, createdBy: { kind: "user", id: "user:owner" }, updatedBy: { kind: "user", id: "user:owner" }, createdAt: timestamp, updatedAt: timestamp } as const;
    expect(WorkspacePageSchema.safeParse(base).success).toBe(true);
    expect(WorkspacePageSchema.safeParse({ ...base, pageId: "workspace.page.second" }).success).toBe(false);
    expect(WorkspacePageSchema.safeParse({ ...base, state: "published" }).success).toBe(false);
    expect(WorkspacePageSchema.safeParse({ ...base, state: "published", publishedRevisionId: "workspace-publication-1", dependencyDigest: digest("b") }).success).toBe(true);
  });

  it("keeps generated envelope semantics and all 22 attack IDs closed and unique", () => {
    const envelope = { $schema: "https://schemas.k-nex.dev/workspace.v1.schema.json", contract: { kind: "working-copy", value: { schemaVersion: 1, identity, revision: 1, document, editorSessionId: "editor-session-1", idempotencyKey: "workspace-save-1", updatedBy: { kind: "user", id: "user:owner" }, updatedAt: timestamp } } } as const;
    expect(WorkspaceContractsSchema.safeParse(envelope).success).toBe(true);
    expect(phase12AttackMap).toHaveLength(22);
    expect(new Set(phase12AttackMap.map(({ id }) => id)).size).toBe(22);
    expect(phase12AttackMap.every(({ expectedDenial, deliveryTask }) => expectedDenial.length > 0 && /^P12\.[1-9]$/u.test(deliveryTask))).toBe(true);
    expect(phase12AttackMap.every(Object.isFrozen)).toBe(true);
  });
});
