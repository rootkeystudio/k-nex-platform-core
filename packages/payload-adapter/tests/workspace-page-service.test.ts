import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecision, UiDocument } from "@k-nex/contracts";
import {
  CurrentAuthorityWorkspacePageService,
  ExactWorkspacePageAclPolicy,
  WorkspacePageSessionRegistry,
  type WorkspacePageImpact,
  type WorkspacePageSnapshot
} from "../src/index.js";

const occurredAt = "2026-09-03T08:00:00.000Z";
const dependencyDigest = `sha256:${"a".repeat(64)}` as const;
const identity = { applicationId: "customer-alpha", environment: "production", pageId: "workspace.page.sales-board", documentId: "workspace.document.sales-board" } as const;
const actor = { kind: "user", id: "user:owner" } as const;
const document = { schemaVersion: 1, id: identity.documentId, version: 1, profile: "workspace", regions: { main: [] } } as const;
const baseSnapshot = {
  page: { schemaVersion: 1, identity, title: "Sales board", state: "draft", navigation: { state: "placed", parentNavigationId: "sales.navigation.root", order: 20 }, workingCopyRevision: 1, accessRevision: 0, revision: 1, createdBy: actor, updatedBy: actor, createdAt: occurredAt, updatedAt: occurredAt },
  access: { schemaVersion: 1, identity, accessRevision: 0, assignments: [{ subject: { kind: "role", roleId: "sales-editor" }, capability: "edit" }, { subject: { kind: "user", userId: "user:viewer" }, capability: "view" }] },
  workingCopy: { schemaVersion: 1, identity, revision: 1, document, editorSessionId: "editor-session-one", idempotencyKey: "workspace-save-one", updatedBy: actor, updatedAt: occurredAt }
} as unknown as WorkspacePageSnapshot;

interface Context {
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
  readonly owner?: boolean;
  readonly authorizationRevision?: number;
  readonly lifecycleRevision?: number;
}

function decision(context: Context, target: Readonly<{ permissionId: string; scope: unknown }>): AuthorizationDecision {
  const outcome = context.permissions.includes(target.permissionId) ? "allow" : "deny";
  return {
    schemaVersion: 1,
    decisionId: "workspace-decision-one",
    correlationId: "workspace-correlation-one",
    applicationId: identity.applicationId,
    environment: identity.environment,
    permissionId: target.permissionId,
    owner: { kind: "platform", namespace: "system" },
    principal: { kind: "user", id: context.userId },
    effectiveActor: { kind: "user", id: context.userId },
    scope: target.scope as never,
    authorizationRevision: context.authorizationRevision ?? 1,
    lifecycleRevision: context.lifecycleRevision ?? 1,
    outcome,
    reason: outcome === "allow" ? "granted" : "permission-not-granted",
    approval: "not-required",
    reauthentication: "not-required"
  };
}

function setup(initial: WorkspacePageSnapshot | null = baseSnapshot) {
  let snapshot: WorkspacePageSnapshot | undefined = initial ?? undefined;
  let impact: WorkspacePageImpact = { state: "ready", catalogRevision: 1, dependencyDigest };
  const create = vi.fn(async (input: any) => {
    snapshot = { page: input.page, access: input.access, workingCopy: input.workingCopy } as WorkspacePageSnapshot;
    return input.page;
  });
  const publish = vi.fn(async (input: any) => input.receipt);
  const replaceAccess = vi.fn(async (input: any) => input.access);
  const saveWorkingCopy = vi.fn(async (_identity: unknown, change: any, updatedBy: unknown) => ({ schemaVersion: 1, identity, revision: change.document.version, document: change.document, editorSessionId: change.editorSessionId, idempotencyKey: change.idempotencyKey, updatedBy, updatedAt: occurredAt }));
  const rollback = vi.fn(async (input: any) => input.receipt);
  const listAudit = vi.fn(async () => [{ auditId: "audit-one", operation: "create", pageRevision: 1, workingCopyRevision: 1, accessRevision: 0, actor, occurredAt }]);
  const store = {
    list: vi.fn(async () => snapshot ? [snapshot.page] : []),
    read: vi.fn(async () => snapshot),
    readByPageId: vi.fn(async (_scope: unknown, pageId: string) => pageId === identity.pageId ? snapshot : undefined),
    readPublishedRevision: vi.fn(async () => undefined),
    create,
    publish,
    rollback,
    listAudit,
    replaceAccess,
    saveWorkingCopy,
    updateMetadata: vi.fn(async (input: any) => input.page)
  };
  const authorityCalls: any[] = [];
  const authority = { authorize: vi.fn(async (context: Context, target: any, signal: AbortSignal) => {
    authorityCalls.push(target);
    return signal.aborted ? undefined : decision(context, target);
  }) };
  const acl = new ExactWorkspacePageAclPolicy<Context>(async ({ context }) => ({ roleIds: context.roles, ownerOverride: context.owner === true }));
  const catalog = {
    resolvePlacement: vi.fn(async (_context: Context, selection: unknown) => {
      if (selection !== "sales-parent") throw new Error("unknown placement");
      return { state: "placed", parentNavigationId: "sales.navigation.root", order: 20 } as const;
    }),
    resolveTheme: vi.fn(async (_context: Context, selection: unknown) => selection === undefined ? undefined : selection === "minimal" ? { profileId: "workspace.theme-profile", revisionId: "workspace.theme-revision", surface: "admin" as const } : Promise.reject(new Error("unknown theme"))),
    dependencies: vi.fn(async () => ({ entries: [], digest: dependencyDigest })),
    impact: vi.fn(async () => impact)
  };
  const documents = {
    validateChange: vi.fn(async ({ document }: { document: UiDocument }) => document),
    validateDocument: vi.fn(async ({ document }: { document: UiDocument }) => document)
  };
  let issued = 0;
  const service = new CurrentAuthorityWorkspacePageService<Context>({
    store: store as never,
    authority,
    acl,
    catalog,
    documents,
    identities: {
      page: (scope) => ({ ...identity, ...scope }),
      publication: () => ({ revisionId: `workspace.publication-${++issued}`, receiptId: `workspace.receipt-${issued}` })
    },
    now: () => new Date(occurredAt)
  });
  return { service, store, catalog, documents, authorityCalls, setImpact: (value: WorkspacePageImpact) => { impact = value; }, snapshot: () => snapshot };
}

const reader: Context = { userId: "user:viewer", permissions: ["system.workspace-pages.read"], roles: [] };
const editor: Context = { userId: "user:editor", permissions: ["system.workspace-pages.read", "system.workspace-pages.edit", "system.workspace-pages.access.manage"], roles: ["sales-editor"] };
const owner: Context = { userId: "user:owner", permissions: ["system.workspace-pages.read", "system.workspace-pages.create", "system.workspace-pages.edit", "system.workspace-pages.publish", "system.workspace-pages.access.manage"], roles: [], owner: true };
const scope = { applicationId: identity.applicationId, environment: identity.environment };

function expectMutationFence(value: any, authorizationRevision = 1, lifecycleRevision = 1): void {
  expect(value).toMatchObject({ applicationId: identity.applicationId, environment: identity.environment, authorizationRevision, lifecycleRevision, catalogRevision: lifecycleRevision });
  expect(value.catalogDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(value.authorityDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(Object.getOwnPropertySymbols(value)).toHaveLength(1);
  expect(Object.getOwnPropertySymbols(JSON.parse(JSON.stringify(value)))).toHaveLength(0);
}

describe("P12.6 current-authority workspace page service", () => {
  it("returns the same non-enumerating denial for missing and unauthorized direct pages", async () => {
    const value = setup();
    await expect(value.service.detail({ ...reader, userId: "user:stranger" }, scope, identity.pageId, "view")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(value.service.detail({ ...reader, permissions: [] }, scope, identity.pageId, "view")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(value.service.detail({ ...reader, permissions: [] }, scope, "workspace.page.missing", "view")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(value.service.detail(reader, scope, "workspace.page.missing", "view")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const detail = await value.service.detail(reader, scope, identity.pageId, "view");
    expect(detail.page.identity).toEqual(identity);
    expect(detail.workingCopy).toBeUndefined();
    expect("access" in detail).toBe(false);
    const [listed] = await value.service.list(reader, scope);
    expect(listed).toEqual({ page: baseSnapshot.page, impact: { state: "ready", catalogRevision: 1, dependencyDigest } });
    expect("snapshot" in listed!).toBe(false);
    expect(await value.service.audit(reader, scope, identity.pageId, 10)).toEqual([{ auditId: "audit-one", operation: "create", pageRevision: 1, workingCopyRevision: 1, accessRevision: 0, actor, occurredAt }]);
    expect(value.authorityCalls.every((target) => target.permissionId.startsWith("system.workspace-pages."))).toBe(true);
    expect(value.authorityCalls.every((target) => target.scope.kind === "application" && target.scope.resource === "system.workspace-pages")).toBe(true);
    expect(value.authorityCalls.some((target) => target.facts.pageId === identity.pageId)).toBe(true);
  });

  it("derives page, placement, theme, actor, and document identity on the server", async () => {
    const value = setup(null);
    const created = await value.service.create(owner, scope, { title: "Pipeline", placementSelection: "sales-parent", themeSelection: "minimal", regions: document.regions, idempotencyKey: "workspace-create-one" });
    expect(created.page.identity).toEqual(identity);
    expect(created.page.navigation).toEqual({ state: "placed", parentNavigationId: "sales.navigation.root", order: 20 });
    expect(created.page.themeProfile).toEqual({ profileId: "workspace.theme-profile", revisionId: "workspace.theme-revision", surface: "admin" });
    expect((value.store.create.mock.calls[0]![0] as any).access.assignments).toEqual([{ subject: { kind: "user", userId: owner.userId }, capability: "edit" }]);
    expect((value.store.create.mock.calls[0]![0] as any).workingCopy.document).toEqual(document);
    expectMutationFence((value.store.create.mock.calls[0]![0] as any).fence);
    expect(value.store.create).toHaveBeenCalledOnce();
  });

  it("denies non-owner ACL expansion beyond the editor's exact held capability", async () => {
    const value = setup();
    await expect(value.service.replaceAccess(editor, scope, identity.pageId, { expectedPageRevision: 1, expectedAccessRevision: 0, assignments: [{ subject: { kind: "user", userId: "user:other" }, capability: "edit" }], idempotencyKey: "workspace-access-one" })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(value.store.replaceAccess).not.toHaveBeenCalled();
  });

  it("keeps metadata, access reads, and archive behind their exact service permissions", async () => {
    const value = setup();
    expect(await value.service.readAccess(editor, scope, identity.pageId)).toEqual(baseSnapshot.access);
    const edited = await value.service.updateMetadata(editor, scope, identity.pageId, { expectedRevision: 1, title: "Edited", placementSelection: "sales-parent", themeSelection: "minimal", idempotencyKey: "workspace-metadata-one" });
    expect(edited).toMatchObject({ title: "Edited", identity, navigation: { parentNavigationId: "sales.navigation.root" }, themeProfile: { profileId: "workspace.theme-profile" } });
    const archived = await value.service.archive(editor, scope, identity.pageId, 1, "workspace-archive-one");
    expect(archived).toMatchObject({ state: "archived", navigation: { state: "unplaced", reason: "manual" } });
    expect(value.authorityCalls.every((target) => target.permissionId.startsWith("system.workspace-pages."))).toBe(true);
    expectMutationFence((value.store.updateMetadata.mock.calls[0]![0] as any).fence);
    expectMutationFence((value.store.updateMetadata.mock.calls[1]![0] as any).fence);
  });

  it("cancels pending editor work after page-access invalidation", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const value = setup();
    const acl = new ExactWorkspacePageAclPolicy<Context>(async ({ context }) => { await blocked; return { roleIds: context.roles, ownerOverride: false }; });
    (value.service as any).options.acl = acl;
    const sessions = new WorkspacePageSessionRegistry();
    const session = sessions.open({ ...scope, pageId: identity.pageId, sessionId: "editor-session-one", authorizationRevision: 1, lifecycleRevision: 1, accessRevision: 0, pageRevision: 1 });
    const pending = value.service.autosave(editor, scope, identity.pageId, { expectedRevision: 1, editorSessionId: "editor-session-one", idempotencyKey: "workspace-save-two", document: { ...document, version: 2 } }, session.signal);
    expect(sessions.invalidate({ ...scope, pageId: identity.pageId, authorizationRevision: 1, lifecycleRevision: 1, accessRevision: 1, pageRevision: 1 })).toBe(1);
    release();
    await expect(pending).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(value.store.saveWorkingCopy).not.toHaveBeenCalled();
  });

  it("binds autosave to the server-derived page and access revisions", async () => {
    const snapshot = {
      ...baseSnapshot,
      page: { ...baseSnapshot.page, revision: 7, accessRevision: 3 },
      access: { ...baseSnapshot.access, accessRevision: 3 }
    } as WorkspacePageSnapshot;
    const value = setup(snapshot);
    await value.service.autosave(editor, scope, identity.pageId, {
      expectedRevision: 1,
      editorSessionId: "editor-session-one",
      idempotencyKey: "workspace-save-server-revisions",
      document: { ...document, version: 2 }
    });
    expect(value.store.saveWorkingCopy).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({ expectedRevision: 1, document: expect.objectContaining({ version: 2 }) }),
      { kind: "user", id: editor.userId },
      { expectedPageRevision: 7, expectedAccessRevision: 3 },
      expect.any(Object)
    );
    expectMutationFence(value.store.saveWorkingCopy.mock.calls[0]![4]);
  });

  it.each([
    ["unsafe props", (prior: UiDocument): UiDocument => ({ ...prior, version: 2, regions: { main: [{ id: "task-table", type: "sales.task-table", version: 1, props: { title: "Safe", administratorOnly: true } }] } })],
    ["binding substitution", (prior: UiDocument): UiDocument => ({ ...prior, version: 2, regions: { main: [{ id: "task-table", type: "sales.task-table", version: 1, props: { title: "Safe" }, bindings: { action: { id: "sales.opportunity.stage.update", version: 1 } } }] } })],
    ["protected structural change", (prior: UiDocument): UiDocument => ({ ...prior, version: 2, regions: { main: [{ id: "task-table", type: "sales.opportunity-kanban", version: 1, props: { title: "Safe" }, bindings: { action: { id: "sales.task.update", version: 1 } } }] } })]
  ])("fails closed before dependency lookup or persistence for malicious %s", async (_attack, change) => {
    const prior: UiDocument = { ...document, regions: { main: [{ id: "task-table", type: "sales.task-table", version: 1, props: { title: "Safe" }, bindings: { action: { id: "sales.task.update", version: 1 } } }] } };
    const maliciousDocument = change(prior);
    const value = setup({ ...baseSnapshot, workingCopy: { ...baseSnapshot.workingCopy, document: prior } } as WorkspacePageSnapshot);
    value.documents.validateChange.mockImplementation(async ({ previous, document: candidate }: { previous: unknown; document: unknown }) => {
      expect(previous).toEqual(prior);
      expect(candidate).toEqual(maliciousDocument);
      throw new TypeError("Workspace builder policy rejected the candidate.");
    });
    await expect(value.service.autosave(editor, scope, identity.pageId, {
      expectedRevision: 1, editorSessionId: "editor-session-one", idempotencyKey: "workspace-save-malicious", document: maliciousDocument
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(value.catalog.dependencies).not.toHaveBeenCalled();
    expect(value.store.saveWorkingCopy).not.toHaveBeenCalled();
  });

  it("validates the initial document before page creation", async () => {
    const value = setup(null);
    value.documents.validateDocument.mockRejectedValue(new TypeError("Workspace builder policy rejected the initial document."));
    await expect(value.service.create(owner, scope, {
      title: "Unsafe page",
      placementSelection: "sales-parent",
      regions: { main: [{ id: "forged", type: "forged.block", version: 1, props: {} }] },
      idempotencyKey: "workspace-create-unsafe"
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(value.store.create).not.toHaveBeenCalled();
  });

  it("re-reads impact after a lost invalidation and rejects stale generation resurrection", async () => {
    const value = setup();
    expect((await value.service.detail(reader, scope, identity.pageId, "view")).impact.state).toBe("ready");
    value.setImpact({ state: "dependency-unavailable", code: "plugin-quarantined", catalogRevision: 2, dependencyDigest });
    expect((await value.service.detail(reader, scope, identity.pageId, "view")).impact).toMatchObject({ state: "dependency-unavailable", code: "plugin-quarantined", catalogRevision: 2 });
    value.setImpact({ state: "ready", catalogRevision: 1, dependencyDigest });
    expect((await value.service.detail(reader, scope, identity.pageId, "view")).impact).toMatchObject({ state: "dependency-unavailable", catalogRevision: 2 });
    expect(value.catalog.impact).toHaveBeenCalledTimes(3);
  });

  it("durably unplaces an authorized page after its plugin parent disappears", async () => {
    const value = setup();
    value.setImpact({ state: "dependency-unavailable", code: "plugin-removed", catalogRevision: 2, dependencyDigest });
    const result = await value.service.reconcile({ ...owner, lifecycleRevision: 2 }, scope);
    expect(value.store.updateMetadata).toHaveBeenCalledWith(expect.objectContaining({
      currentRevision: 1,
      idempotencyKey: "workspace-reconcile-1-2",
      page: expect.objectContaining({ navigation: { state: "unplaced", reason: "parent-missing" }, revision: 2 })
    }));
    expectMutationFence((value.store.updateMetadata.mock.calls[0]![0] as any).fence, 1, 2);
    expect(result).toHaveLength(1);
  });

  it.each(["plugin-disabled", "plugin-updated", "plugin-removed", "theme-unavailable", "source-unavailable", "action-unavailable"] as const)("projects %s from fresh catalog truth", async (code) => {
    const value = setup();
    value.setImpact({ state: "dependency-unavailable", code, catalogRevision: 2, dependencyDigest });
    expect((await value.service.detail(reader, scope, identity.pageId, "view")).impact).toMatchObject({ state: "dependency-unavailable", code });
  });

  it("requires current publish authority and fresh ready dependencies before storage", async () => {
    const value = setup();
    value.setImpact({ state: "dependency-unavailable", code: "theme-unavailable", catalogRevision: 2, dependencyDigest });
    await expect(value.service.publish(owner, scope, identity.pageId, { workingCopyRevision: 1, idempotencyKey: "workspace-publish-one" })).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(value.store.publish).not.toHaveBeenCalled();
  });

  it("revalidates the exact current working document before publication", async () => {
    const value = setup();
    value.documents.validateDocument.mockImplementation(async ({ document: candidate }: { document: unknown }) => {
      expect(candidate).toEqual(document);
      throw new TypeError("Workspace builder policy rejected the current document.");
    });
    await expect(value.service.publish(owner, scope, identity.pageId, { workingCopyRevision: 1, idempotencyKey: "workspace-publish-invalid" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(value.catalog.dependencies).not.toHaveBeenCalled();
    expect(value.store.publish).not.toHaveBeenCalled();
  });

  it("fails closed before page or pointer mutation and store rollback for missing or dependency-unavailable target revisions", async () => {
    const targetTheme = { profileId: "workspace.theme-profile-old", revisionId: "workspace.theme-revision-old", surface: "admin" } as const;
    const target = { schemaVersion: 1, revisionId: "workspace.publication-old", identity, documentRevision: 1, document, page: { ...baseSnapshot.page, state: "published", publishedRevisionId: "workspace.publication-old", themeProfile: targetTheme, dependencyDigest, revision: 2 }, access: baseSnapshot.access, themeProfile: targetTheme, dependencies: { entries: [], digest: dependencyDigest }, publishedBy: actor, publishedAt: occurredAt } as const;
    const current = { ...target, revisionId: "workspace.publication-current" };
    const publishedSnapshot = {
      ...baseSnapshot,
      page: { ...baseSnapshot.page, state: "published", publishedRevisionId: current.revisionId, dependencyDigest, revision: 2 },
      publication: { pointer: { schemaVersion: 1, identity, pointerRevision: 1, publishedRevisionId: current.revisionId, publishedDocumentRevision: 1, updatedAt: occurredAt }, revision: current }
    } as unknown as WorkspacePageSnapshot;

    const missingSnapshot = structuredClone(publishedSnapshot);
    const missing = setup(missingSnapshot);
    await expect(missing.service.rollback(owner, scope, identity.pageId, "workspace.publication-missing", "workspace-rollback-missing")).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(missing.store.rollback).not.toHaveBeenCalled();
    expect(missing.snapshot()).toEqual(publishedSnapshot);

    const unavailableSnapshot = structuredClone(publishedSnapshot);
    const unavailable = setup(unavailableSnapshot);
    unavailable.store.readPublishedRevision.mockResolvedValue(target);
    unavailable.setImpact({ state: "dependency-unavailable", code: "plugin-removed", catalogRevision: 2, dependencyDigest });
    await expect(unavailable.service.rollback(owner, scope, identity.pageId, target.revisionId, "workspace-rollback-unavailable")).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(unavailable.store.rollback).not.toHaveBeenCalled();
    expect(unavailable.snapshot()).toEqual(publishedSnapshot);
  });

  it("derives publication and rollback identities, authority digest, and dependencies server-side", async () => {
    const publishValue = setup();
    const receipt = await publishValue.service.publish(owner, scope, identity.pageId, { workingCopyRevision: 1, idempotencyKey: "workspace-publish-one" });
    expect(receipt).toMatchObject({ operation: "publish", identity, publishedRevisionId: "workspace.publication-1", dependencyDigest });
    const publishedInput = publishValue.store.publish.mock.calls[0]![0] as any;
    expect(publishedInput.revision.document).toEqual(document);
    expect(publishedInput.revision.page).toEqual(publishedInput.page);
    expect(publishedInput.revision.access).toEqual(baseSnapshot.access);
    expect(publishedInput.revision.dependencies).toEqual({ entries: [], digest: dependencyDigest });
    expect(publishedInput.receipt.authorityDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expectMutationFence(publishedInput.fence);

    const targetTheme = { profileId: "workspace.theme-profile-old", revisionId: "workspace.theme-revision-old", surface: "admin" } as const;
    const target = { schemaVersion: 1, revisionId: "workspace.publication-old", identity, documentRevision: 1, document, page: { ...baseSnapshot.page, title: "Historical title", description: "Historical description", state: "published", navigation: { state: "placed", parentNavigationId: "sales.navigation.root", order: 1 }, publishedRevisionId: "workspace.publication-old", themeProfile: targetTheme, dependencyDigest, revision: 2 }, access: { ...baseSnapshot.access, assignments: [{ subject: { kind: "user", userId: "user:historical-viewer" }, capability: "view" }] }, themeProfile: targetTheme, dependencies: { entries: [], digest: dependencyDigest }, publishedBy: actor, publishedAt: occurredAt } as const;
    const current = { ...target, revisionId: "workspace.publication-current" };
    const currentAccess = { ...baseSnapshot.access, accessRevision: 1, assignments: [{ subject: { kind: "user", userId: "user:current-viewer" }, capability: "view" }] } as const;
    const publishedSnapshot = {
      ...baseSnapshot,
      page: { ...baseSnapshot.page, state: "published", publishedRevisionId: current.revisionId, dependencyDigest, themeProfile: { profileId: "workspace.theme-profile-current", revisionId: "workspace.theme-revision-current", surface: "admin" }, accessRevision: currentAccess.accessRevision, revision: 2 },
      access: currentAccess,
      publication: { pointer: { schemaVersion: 1, identity, pointerRevision: 1, publishedRevisionId: current.revisionId, publishedDocumentRevision: 1, updatedAt: occurredAt }, revision: current }
    } as unknown as WorkspacePageSnapshot;
    const rollbackValue = setup(publishedSnapshot);
    rollbackValue.store.readPublishedRevision.mockResolvedValue(target);
    const rolledBack = await rollbackValue.service.rollback(owner, scope, identity.pageId, target.revisionId, "workspace-rollback-one");
    expect(rolledBack).toMatchObject({ operation: "rollback", publishedRevisionId: target.revisionId, previousPublishedRevisionId: current.revisionId });
    expect((rollbackValue.store.rollback.mock.calls[0]![0] as any).page).toMatchObject({ title: baseSnapshot.page.title, navigation: baseSnapshot.page.navigation, accessRevision: currentAccess.accessRevision, themeProfile: targetTheme, dependencyDigest: target.dependencies.digest });
    expectMutationFence((rollbackValue.store.rollback.mock.calls[0]![0] as any).fence);
    expect(rollbackValue.store.rollback).toHaveBeenCalledOnce();
  });

  it("passes a service-minted fence to ACL storage and rejects a catalog observation from another lifecycle", async () => {
    const value = setup();
    await value.service.replaceAccess(owner, scope, identity.pageId, {
      expectedPageRevision: 1,
      expectedAccessRevision: 0,
      assignments: [{ subject: { kind: "user", userId: "user:viewer" }, capability: "view" }],
      idempotencyKey: "workspace-access-owner"
    });
    expectMutationFence((value.store.replaceAccess.mock.calls[0]![0] as any).fence);

    const stale = setup();
    await expect(stale.service.updateMetadata({ ...editor, lifecycleRevision: 2 }, scope, identity.pageId, {
      expectedRevision: 1,
      title: "Stale catalog",
      placementSelection: "sales-parent",
      idempotencyKey: "workspace-metadata-stale-catalog"
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(stale.store.updateMetadata).not.toHaveBeenCalled();
  });
});

describe("P12.6 workspace page session registry", () => {
  it("applies global monotonic authority invalidation to current and future sessions", () => {
    const sessions = new WorkspacePageSessionRegistry();
    const first = sessions.open({ ...scope, pageId: identity.pageId, sessionId: "session-one", authorizationRevision: 2, lifecycleRevision: 1, accessRevision: 0, pageRevision: 1 });
    expect(sessions.invalidate({ ...scope, authorizationRevision: 3, lifecycleRevision: 1 })).toBe(1);
    expect(first.signal.aborted).toBe(true);
    expect(() => sessions.open({ ...scope, pageId: identity.pageId, sessionId: "session-two", authorizationRevision: 2, lifecycleRevision: 1, accessRevision: 0, pageRevision: 1 })).toThrow(/stale/u);
  });
});
