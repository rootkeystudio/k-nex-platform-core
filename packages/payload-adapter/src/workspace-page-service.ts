import { createHash } from "node:crypto";

import {
  canonicalJson,
  WorkspacePageAccessSnapshotSchema,
  WorkspaceWorkingCopyChangeInputSchema,
  type AuthorizationDecision,
  type WorkspacePage,
  type WorkspacePageAccessSnapshot,
  type WorkspacePageIdentity,
  type WorkspacePublicationReceipt,
  type WorkspacePublishedRevision,
  type UiDocument
} from "@k-nex/contracts";
import { createCurrentAuthorityTarget, type CurrentAuthorityAdapter } from "@k-nex/runtime";

import { issueWorkspacePageMutationFence, PostgresWorkspacePageStore, type WorkspacePageAuditEntry, type WorkspacePageCatalogObservation, type WorkspacePageMutationFence, type WorkspacePageScope, type WorkspacePageSnapshot } from "./workspace-page-store.js";

type WorkspaceNavigationPlacement = WorkspacePage["navigation"];
type WorkspacePageAccessAssignment = WorkspacePageAccessSnapshot["assignments"][number];
type WorkspaceThemeProfileRef = NonNullable<WorkspacePage["themeProfile"]>;

export type WorkspacePageServiceErrorCode = "NOT_FOUND" | "ACCESS_DENIED" | "DEPENDENCY_UNAVAILABLE" | "INVALID_INPUT" | "REVISION_CONFLICT";

export class WorkspacePageServiceError extends Error {
  constructor(readonly code: WorkspacePageServiceErrorCode, message: string) {
    super(message);
    this.name = "WorkspacePageServiceError";
  }
}

export interface WorkspacePageImpact {
  readonly state: "ready" | "dependency-unavailable";
  readonly catalogRevision: number;
  readonly dependencyDigest: `sha256:${string}`;
  readonly code?: "plugin-disabled" | "plugin-quarantined" | "plugin-updated" | "plugin-removed" | "theme-unavailable" | "source-unavailable" | "action-unavailable";
}

export interface WorkspacePageAclPolicy<TContext> {
  allows(input: Readonly<{
    context: TContext;
    decision: AuthorizationDecision;
    snapshot: WorkspacePageSnapshot;
    capability: "view" | "edit";
    signal: AbortSignal;
  }>): boolean | Promise<boolean>;
  allowsReplacement(input: Readonly<{
    context: TContext;
    decision: AuthorizationDecision;
    snapshot: WorkspacePageSnapshot;
    assignments: readonly WorkspacePageAccessAssignment[];
    signal: AbortSignal;
  }>): boolean | Promise<boolean>;
}

export interface WorkspacePageCatalog<TContext> {
  resolvePlacement(context: TContext, selection: unknown, signal: AbortSignal): WorkspaceNavigationPlacement | Promise<WorkspaceNavigationPlacement>;
  resolveTheme(context: TContext, selection: unknown, signal: AbortSignal): WorkspaceThemeProfileRef | undefined | Promise<WorkspaceThemeProfileRef | undefined>;
  dependencies(input: Readonly<{ context: TContext; snapshot: WorkspacePageSnapshot; signal: AbortSignal }>): WorkspacePublishedRevision["dependencies"] | Promise<WorkspacePublishedRevision["dependencies"]>;
  impact(input: Readonly<{ context: TContext; snapshot: WorkspacePageSnapshot; revision?: WorkspacePublishedRevision; signal: AbortSignal }>): WorkspacePageImpact | Promise<WorkspacePageImpact>;
  observe(input: Readonly<{ context: TContext; snapshot: WorkspacePageSnapshot; revision?: WorkspacePublishedRevision; signal: AbortSignal }>): Pick<WorkspacePageCatalogObservation, "extensionGenerations" | "themePublication"> | Promise<Pick<WorkspacePageCatalogObservation, "extensionGenerations" | "themePublication">>;
}

export interface WorkspacePageIdentityIssuer {
  page(scope: WorkspacePageScope): WorkspacePageIdentity;
  publication(identity: WorkspacePageIdentity): Readonly<{ revisionId: string; receiptId: string }>;
}

/** Server-owned document policy; the browser may propose a document but cannot authorize it. */
export interface WorkspacePageDocumentValidator<TContext> {
  validateChange(input: Readonly<{
    context: TContext;
    snapshot: WorkspacePageSnapshot;
    previous: UiDocument;
    document: UiDocument;
    signal: AbortSignal;
  }>): UiDocument | Promise<UiDocument>;
  validateDocument(input: Readonly<{
    context: TContext;
    snapshot?: WorkspacePageSnapshot;
    document: UiDocument;
    signal: AbortSignal;
  }>): UiDocument | Promise<UiDocument>;
}

export interface WorkspacePageServiceOptions<TContext> {
  readonly store: PostgresWorkspacePageStore;
  readonly authority: Pick<CurrentAuthorityAdapter<TContext>, "authorize">;
  readonly acl: WorkspacePageAclPolicy<TContext>;
  readonly catalog: WorkspacePageCatalog<TContext>;
  readonly documents: WorkspacePageDocumentValidator<TContext>;
  readonly identities: WorkspacePageIdentityIssuer;
  readonly now: () => Date;
}

export interface WorkspacePageListItem {
  readonly page: WorkspacePage;
  readonly impact: WorkspacePageImpact;
}

export interface WorkspacePageDetail extends WorkspacePageListItem {
  readonly publication?: WorkspacePageSnapshot["publication"];
  readonly workingCopy?: WorkspacePageSnapshot["workingCopy"];
}

export interface WorkspacePageSessionInvalidation extends WorkspacePageScope {
  readonly pageId?: string;
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
  readonly accessRevision?: number;
  readonly pageRevision?: number;
}

interface OpenSession {
  readonly owner: WorkspacePageScope & { readonly pageId: string };
  readonly sessionId: string;
  readonly controller: AbortController;
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
  readonly accessRevision: number;
  readonly pageRevision: number;
}

function failure(code: WorkspacePageServiceErrorCode, message: string): never {
  throw new WorkspacePageServiceError(code, message);
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function iso(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) failure("INVALID_INPUT", "Workspace page clock is invalid.");
  return value.toISOString();
}

function safeCall<T>(operation: () => T | Promise<T>): Promise<T | undefined> {
  return Promise.resolve().then(operation).catch(() => undefined);
}

function combineSignals(...signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  return present.length === 0 ? new AbortController().signal : present.length === 1 ? present[0]! : AbortSignal.any(present);
}

/** Cancels open page/editor work on monotonic authority, ACL, page, or lifecycle advances. */
export class WorkspacePageSessionRegistry {
  private readonly sessions = new Map<string, OpenSession>();
  private readonly watermarks = new Map<string, WorkspacePageSessionInvalidation>();

  open(input: WorkspacePageSessionInvalidation & Readonly<{ pageId: string; sessionId: string }>): Readonly<{ signal: AbortSignal; close(): void }> {
    const key = this.key(input, input.sessionId);
    if (this.sessions.has(key)) failure("INVALID_INPUT", "Workspace page session already exists.");
    const snapshot = { authorizationRevision: input.authorizationRevision, lifecycleRevision: input.lifecycleRevision, accessRevision: input.accessRevision ?? 0, pageRevision: input.pageRevision ?? 0 };
    for (const watermark of [this.watermarks.get(this.scopeKey(input)), this.watermarks.get(this.scopeKey({ applicationId: input.applicationId, environment: input.environment }))]) {
      if (watermark && this.invalidates(watermark, snapshot)) failure("ACCESS_DENIED", "Workspace page session authority is stale.");
    }
    const controller = new AbortController();
    const session: OpenSession = { owner: { applicationId: input.applicationId, environment: input.environment, pageId: input.pageId }, sessionId: input.sessionId, controller, authorizationRevision: input.authorizationRevision, lifecycleRevision: input.lifecycleRevision, accessRevision: input.accessRevision ?? 0, pageRevision: input.pageRevision ?? 0 };
    this.sessions.set(key, session);
    return Object.freeze({ signal: controller.signal, close: () => { if (this.sessions.delete(key)) controller.abort(); } });
  }

  invalidate(input: WorkspacePageSessionInvalidation): number {
    const scopeKey = this.scopeKey(input);
    const previous = this.watermarks.get(scopeKey);
    if (previous && !this.newer(input, previous)) return 0;
    const watermark = Object.freeze({
      ...input,
      authorizationRevision: Math.max(input.authorizationRevision, previous?.authorizationRevision ?? 0),
      lifecycleRevision: Math.max(input.lifecycleRevision, previous?.lifecycleRevision ?? 0),
      ...(input.accessRevision === undefined && previous?.accessRevision === undefined ? {} : { accessRevision: Math.max(input.accessRevision ?? 0, previous?.accessRevision ?? 0) }),
      ...(input.pageRevision === undefined && previous?.pageRevision === undefined ? {} : { pageRevision: Math.max(input.pageRevision ?? 0, previous?.pageRevision ?? 0) })
    });
    this.watermarks.set(scopeKey, watermark);
    let count = 0;
    for (const [key, session] of this.sessions) {
      if (session.owner.applicationId !== input.applicationId || session.owner.environment !== input.environment || input.pageId !== undefined && session.owner.pageId !== input.pageId || !this.invalidates(watermark, session)) continue;
      this.sessions.delete(key);
      session.controller.abort();
      count += 1;
    }
    return count;
  }

  private invalidates(invalidation: WorkspacePageSessionInvalidation, session: Pick<OpenSession, "authorizationRevision" | "lifecycleRevision" | "accessRevision" | "pageRevision">): boolean {
    return invalidation.authorizationRevision > session.authorizationRevision || invalidation.lifecycleRevision > session.lifecycleRevision ||
      (invalidation.accessRevision ?? 0) > session.accessRevision || (invalidation.pageRevision ?? 0) > session.pageRevision;
  }

  private newer(left: WorkspacePageSessionInvalidation, right: WorkspacePageSessionInvalidation): boolean {
    return left.authorizationRevision > right.authorizationRevision || left.lifecycleRevision > right.lifecycleRevision ||
      (left.accessRevision ?? 0) > (right.accessRevision ?? 0) || (left.pageRevision ?? 0) > (right.pageRevision ?? 0);
  }

  private scopeKey(input: WorkspacePageScope & { readonly pageId?: string }): string {
    return canonicalJson([input.applicationId, input.environment, input.pageId ?? "*"]);
  }

  private key(input: WorkspacePageScope & { readonly pageId: string }, sessionId: string): string {
    return canonicalJson([input.applicationId, input.environment, input.pageId, sessionId]);
  }
}

/** Closed workspace-page service: current authority, exact ACL, and fresh catalog impact precede every result or mutation. */
export class CurrentAuthorityWorkspacePageService<TContext> {
  private readonly impacts = new Map<string, WorkspacePageImpact>();
  constructor(private readonly options: WorkspacePageServiceOptions<TContext>) {}

  async list(context: TContext, scope: WorkspacePageScope, signal?: AbortSignal): Promise<readonly WorkspacePageListItem[]> {
    const active = combineSignals(signal);
    await this.authorize(context, scope, "system.workspace-pages.read", undefined, "list", active);
    const pages = await this.options.store.list(scope);
    const visible: WorkspacePageListItem[] = [];
    for (const page of pages) {
      if (page.state === "archived" || active.aborted) continue;
      const snapshot = await this.options.store.read(page.identity);
      if (!snapshot) continue;
      const decision = await this.authorize(context, scope, "system.workspace-pages.read", snapshot.page.identity.pageId, "list-item", active, false);
      if (decision && await safeCall(() => this.options.acl.allows({ context, decision, snapshot, capability: "view", signal: active })) === true) {
        const impact = await this.impact(context, snapshot, active);
        visible.push(Object.freeze({ page: snapshot.page, impact }));
      }
    }
    await this.authorize(context, scope, "system.workspace-pages.read", undefined, "list-complete", active);
    return Object.freeze(visible);
  }

  async detail(context: TContext, scope: WorkspacePageScope, pageId: string, capability: "view" | "edit", signal?: AbortSignal): Promise<WorkspacePageDetail> {
    const active = combineSignals(signal);
    const permission = capability === "view" ? "system.workspace-pages.read" : "system.workspace-pages.edit";
    await this.pageAdmission(context, scope, permission, undefined, `${capability}-lookup`, active);
    const snapshot = await this.locate(scope, pageId);
    if (snapshot.page.state === "archived") failure("NOT_FOUND", "Workspace page is unavailable.");
    const decision = await this.pageAdmission(context, scope, permission, snapshot.page.identity.pageId, capability, active);
    if (await safeCall(() => this.options.acl.allows({ context, decision, snapshot, capability, signal: active })) !== true) failure("NOT_FOUND", "Workspace page is unavailable.");
    const impact = await this.impact(context, snapshot, active);
    await this.authorize(context, scope, permission, snapshot.page.identity.pageId, `${capability}-complete`, active);
    return this.project(snapshot, impact, capability);
  }

  async create(context: TContext, scope: WorkspacePageScope, input: Readonly<{ title: string; description?: string; placementSelection: unknown; themeSelection?: unknown; regions: unknown; idempotencyKey: string }>, signal?: AbortSignal): Promise<WorkspacePageDetail> {
    const active = combineSignals(signal);
    const decision = await this.authorize(context, scope, "system.workspace-pages.create", undefined, "create", active);
    if (decision.effectiveActor.kind !== "user") failure("ACCESS_DENIED", "Workspace pages require a user actor.");
    const identity = this.options.identities.page(scope);
    if (identity.applicationId !== scope.applicationId || identity.environment !== scope.environment) failure("INVALID_INPUT", "Workspace page issuer returned a foreign identity.");
    const [navigation, themeProfile] = await Promise.all([
      this.options.catalog.resolvePlacement(context, input.placementSelection, active),
      this.options.catalog.resolveTheme(context, input.themeSelection, active)
    ]);
    if (active.aborted) failure("ACCESS_DENIED", "Workspace page creation was revoked.");
    const occurredAt = iso(this.options.now);
    const proposedDocument = { schemaVersion: 1, id: identity.documentId, version: 1, profile: "workspace", regions: input.regions } as UiDocument;
    const document = await safeCall(() => this.options.documents.validateDocument({ context, document: proposedDocument, signal: active }));
    if (!document || active.aborted) failure("INVALID_INPUT", "Workspace page document is invalid.");
    const workingCopy = { schemaVersion: 1, identity, revision: 1, document, editorSessionId: "workspace-create-session", idempotencyKey: input.idempotencyKey, updatedBy: decision.effectiveActor, updatedAt: occurredAt };
    const access = { schemaVersion: 1, identity, accessRevision: 0, assignments: [{ subject: { kind: "user", userId: decision.effectiveActor.id }, capability: "edit" }] };
    const page = { schemaVersion: 1, identity, title: input.title, ...(input.description === undefined ? {} : { description: input.description }), state: "draft", navigation, workingCopyRevision: 1, accessRevision: 0, ...(themeProfile === undefined ? {} : { themeProfile }), revision: 1, createdBy: decision.effectiveActor, updatedBy: decision.effectiveActor, createdAt: occurredAt, updatedAt: occurredAt };
    const candidate = { page, access, workingCopy } as WorkspacePageSnapshot;
    const dependencies = await safeCall(() => this.options.catalog.dependencies({ context, snapshot: candidate, signal: active })) ?? failure("DEPENDENCY_UNAVAILABLE", "Workspace page dependencies are unavailable.");
    const impact = await this.impact(context, candidate, active);
    const commitDecision = await this.authorize(context, scope, "system.workspace-pages.create", undefined, "create-commit", active);
    const fence = this.mutationFence(commitDecision, await this.observation(context, candidate, impact, { navigation, themeProfile: themeProfile ?? null, document, dependencies }, active));
    await this.options.store.create({ page, access, workingCopy, idempotencyKey: input.idempotencyKey, fence });
    const snapshot = (await this.options.store.read(identity)) ?? failure("NOT_FOUND", "Created workspace page is unavailable.");
    return this.project(snapshot, await this.impact(context, snapshot, active), "edit");
  }

  async updateMetadata(context: TContext, scope: WorkspacePageScope, pageId: string, input: Readonly<{ expectedRevision: number; title: string; description?: string; placementSelection: unknown; themeSelection?: unknown; idempotencyKey: string }>, signal?: AbortSignal): Promise<WorkspacePage> {
    const active = combineSignals(signal);
    const { snapshot, decision } = await this.authorizedSnapshot(context, scope, pageId, "system.workspace-pages.edit", "edit", active, "edit");
    const [navigation, themeProfile] = await Promise.all([
      this.options.catalog.resolvePlacement(context, input.placementSelection, active),
      this.options.catalog.resolveTheme(context, input.themeSelection, active)
    ]);
    const page = { ...snapshot.page, title: input.title, description: input.description, navigation, themeProfile, revision: snapshot.page.revision + 1, updatedBy: decision.effectiveActor, updatedAt: iso(this.options.now) };
    const impact = await this.impact(context, { ...snapshot, page }, active);
    const commitDecision = await this.authorize(context, scope, "system.workspace-pages.edit", pageId, "edit-commit", active);
    return this.options.store.updateMetadata({ currentRevision: input.expectedRevision, page, idempotencyKey: input.idempotencyKey, fence: this.mutationFence(commitDecision, await this.observation(context, { ...snapshot, page }, impact, { navigation, themeProfile: themeProfile ?? null }, active)) });
  }

  async autosave(context: TContext, scope: WorkspacePageScope, pageId: string, changeValue: unknown, sessionSignal?: AbortSignal, signal?: AbortSignal) {
    const active = combineSignals(signal, sessionSignal);
    const change = WorkspaceWorkingCopyChangeInputSchema.safeParse(changeValue);
    if (!change.success) failure("INVALID_INPUT", "Workspace autosave input is invalid.");
    const { snapshot, decision } = await this.authorizedSnapshot(context, scope, pageId, "system.workspace-pages.edit", "autosave", active, "edit");
    const document = await safeCall(() => this.options.documents.validateChange({ context, snapshot, previous: snapshot.workingCopy.document, document: change.data.document, signal: active }));
    if (!document || active.aborted) failure("INVALID_INPUT", "Workspace autosave document is invalid.");
    const candidate = { ...snapshot, workingCopy: { ...snapshot.workingCopy, revision: document.version, document } };
    const dependencies = await safeCall(() => this.options.catalog.dependencies({ context, snapshot: candidate, signal: active })) ?? failure("DEPENDENCY_UNAVAILABLE", "Workspace autosave dependencies are unavailable.");
    const impact = await this.impact(context, candidate, active);
    const commitDecision = await this.authorize(context, scope, "system.workspace-pages.edit", pageId, "autosave-commit", active);
    return this.options.store.saveWorkingCopy(snapshot.page.identity, { ...change.data, document }, decision.effectiveActor, {
      expectedPageRevision: snapshot.page.revision,
      expectedAccessRevision: snapshot.access.accessRevision
    }, this.mutationFence(commitDecision, await this.observation(context, candidate, impact, dependencies, active)));
  }

  async replaceAccess(context: TContext, scope: WorkspacePageScope, pageId: string, input: Readonly<{ expectedPageRevision: number; expectedAccessRevision: number; assignments: readonly WorkspacePageAccessAssignment[]; idempotencyKey: string }>, signal?: AbortSignal) {
    const active = combineSignals(signal);
    const { snapshot, decision } = await this.authorizedSnapshot(context, scope, pageId, "system.workspace-pages.access.manage", "access", active, "edit");
    const access = WorkspacePageAccessSnapshotSchema.safeParse({ schemaVersion: 1, identity: snapshot.page.identity, accessRevision: input.expectedAccessRevision + 1, assignments: input.assignments });
    if (!access.success || await safeCall(() => this.options.acl.allowsReplacement({ context, decision, snapshot, assignments: access.data.assignments, signal: active })) !== true) failure("ACCESS_DENIED", "Workspace page access replacement is denied.");
    const impact = await this.impact(context, snapshot, active);
    const commitDecision = await this.authorize(context, scope, "system.workspace-pages.access.manage", pageId, "access-commit", active);
    return this.options.store.replaceAccess({ access: access.data, expectedPageRevision: input.expectedPageRevision, expectedAccessRevision: input.expectedAccessRevision, idempotencyKey: input.idempotencyKey, updatedBy: decision.effectiveActor, fence: this.mutationFence(commitDecision, await this.observation(context, snapshot, impact, access.data, active)) });
  }

  async readAccess(context: TContext, scope: WorkspacePageScope, pageId: string, signal?: AbortSignal): Promise<WorkspacePageAccessSnapshot> {
    const active = combineSignals(signal);
    const { snapshot } = await this.authorizedSnapshot(context, scope, pageId, "system.workspace-pages.access.manage", "access-read", active, "edit");
    await this.authorize(context, scope, "system.workspace-pages.access.manage", pageId, "access-read-complete", active);
    return snapshot.access;
  }

  async audit(context: TContext, scope: WorkspacePageScope, pageId: string, limit = 100, signal?: AbortSignal): Promise<readonly WorkspacePageAuditEntry[]> {
    const active = combineSignals(signal);
    await this.authorizedSnapshot(context, scope, pageId, "system.workspace-pages.read", "audit", active, "view");
    await this.authorize(context, scope, "system.workspace-pages.read", pageId, "audit-complete", active);
    return this.options.store.listAudit((await this.locate(scope, pageId)).page.identity, limit);
  }

  async publish(context: TContext, scope: WorkspacePageScope, pageId: string, input: Readonly<{ workingCopyRevision: number; idempotencyKey: string }>, signal?: AbortSignal): Promise<WorkspacePublicationReceipt> {
    const active = combineSignals(signal);
    const { snapshot, decision } = await this.authorizedSnapshot(context, scope, pageId, "system.workspace-pages.publish", "publish", active, "edit");
    if (snapshot.workingCopy.revision !== input.workingCopyRevision) failure("REVISION_CONFLICT", "Workspace publication working copy changed.");
    const document = await safeCall(() => this.options.documents.validateDocument({ context, snapshot, document: snapshot.workingCopy.document, signal: active }));
    if (!document || active.aborted) failure("INVALID_INPUT", "Workspace publication document is invalid.");
    const candidate = { ...snapshot, workingCopy: { ...snapshot.workingCopy, document } };
    const dependencies = await this.options.catalog.dependencies({ context, snapshot: candidate, signal: active });
    const impact = await this.options.catalog.impact({ context, snapshot: candidate, signal: active });
    if (impact.state !== "ready" || active.aborted) failure("DEPENDENCY_UNAVAILABLE", "Workspace page dependencies are unavailable.");
    const ids = this.options.identities.publication(snapshot.page.identity);
    const occurredAt = iso(this.options.now);
    const pointerRevision = (snapshot.publication?.pointer.pointerRevision ?? 0) + 1;
    const pointer = { schemaVersion: 1, identity: snapshot.page.identity, pointerRevision, publishedRevisionId: ids.revisionId, publishedDocumentRevision: snapshot.workingCopy.revision, ...(snapshot.publication ? { previousPublishedRevisionId: snapshot.publication.pointer.publishedRevisionId } : {}), updatedAt: occurredAt };
    const page: WorkspacePage = { ...snapshot.page, state: "published", publishedRevisionId: ids.revisionId, dependencyDigest: dependencies.digest, revision: snapshot.page.revision + 1, updatedBy: decision.effectiveActor, updatedAt: occurredAt };
    const revision = { schemaVersion: 1, revisionId: ids.revisionId, identity: snapshot.page.identity, documentRevision: snapshot.workingCopy.revision, document, page, access: snapshot.access, ...(snapshot.page.themeProfile === undefined ? {} : { themeProfile: snapshot.page.themeProfile }), dependencies, publishedBy: decision.effectiveActor, publishedAt: occurredAt };
    const receipt = { schemaVersion: 1, receiptId: ids.receiptId, operation: "publish", identity: snapshot.page.identity, pointerRevision, publishedRevisionId: ids.revisionId, ...(snapshot.publication ? { previousPublishedRevisionId: snapshot.publication.pointer.publishedRevisionId } : {}), accessRevision: snapshot.access.accessRevision, dependencyDigest: dependencies.digest, requestedBy: decision.effectiveActor, authorityDigest: sha256(decision), idempotencyKey: input.idempotencyKey, occurredAt };
    const commitDecision = await this.authorize(context, scope, "system.workspace-pages.publish", pageId, "publish-commit", active);
    return this.options.store.publish({ page, revision, pointer, receipt, fence: this.mutationFence(commitDecision, await this.observation(context, { ...candidate, page }, impact, dependencies, active)) });
  }

  async rollback(context: TContext, scope: WorkspacePageScope, pageId: string, targetRevisionId: string, idempotencyKey: string, signal?: AbortSignal): Promise<WorkspacePublicationReceipt> {
    const active = combineSignals(signal);
    const { snapshot, decision } = await this.authorizedSnapshot(context, scope, pageId, "system.workspace-pages.publish", "rollback", active, "edit");
    if (!snapshot.publication) failure("DEPENDENCY_UNAVAILABLE", "Workspace page has no publication to roll back.");
    const target = await this.options.store.readPublishedRevision(snapshot.page.identity, targetRevisionId);
    if (!target) failure("DEPENDENCY_UNAVAILABLE", "Workspace rollback target is unavailable.");
    const impact = await this.options.catalog.impact({ context, snapshot, revision: target, signal: active });
    if (impact.state !== "ready" || active.aborted) failure("DEPENDENCY_UNAVAILABLE", "Workspace rollback dependencies are unavailable.");
    const ids = this.options.identities.publication(snapshot.page.identity);
    const occurredAt = iso(this.options.now);
    const pointerRevision = snapshot.publication.pointer.pointerRevision + 1;
    const pointer = { schemaVersion: 1, identity: snapshot.page.identity, pointerRevision, publishedRevisionId: target.revisionId, publishedDocumentRevision: target.documentRevision, previousPublishedRevisionId: snapshot.publication.pointer.publishedRevisionId, updatedAt: occurredAt };
    const page: WorkspacePage = { ...snapshot.page, state: "published", publishedRevisionId: target.revisionId, dependencyDigest: target.dependencies.digest, themeProfile: target.themeProfile, revision: snapshot.page.revision + 1, updatedBy: decision.effectiveActor, updatedAt: occurredAt };
    const receipt = { schemaVersion: 1, receiptId: ids.receiptId, operation: "rollback", identity: snapshot.page.identity, pointerRevision, publishedRevisionId: target.revisionId, previousPublishedRevisionId: snapshot.publication.pointer.publishedRevisionId, accessRevision: snapshot.access.accessRevision, dependencyDigest: target.dependencies.digest, requestedBy: decision.effectiveActor, authorityDigest: sha256(decision), idempotencyKey, occurredAt };
    const commitDecision = await this.authorize(context, scope, "system.workspace-pages.publish", pageId, "rollback-commit", active);
    return this.options.store.rollback({ page, pointer, receipt, fence: this.mutationFence(commitDecision, await this.observation(context, { ...snapshot, page }, impact, target.dependencies, active, target)) });
  }

  async archive(context: TContext, scope: WorkspacePageScope, pageId: string, expectedRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<WorkspacePage> {
    const active = combineSignals(signal);
    const { snapshot, decision } = await this.authorizedSnapshot(context, scope, pageId, "system.workspace-pages.edit", "archive", active, "edit");
    const page: WorkspacePage = { ...snapshot.page, state: "archived", navigation: { state: "unplaced", reason: "manual" }, revision: snapshot.page.revision + 1, updatedBy: decision.effectiveActor, updatedAt: iso(this.options.now) };
    const impact = await this.impact(context, snapshot, active);
    const commitDecision = await this.authorize(context, scope, "system.workspace-pages.edit", pageId, "archive-commit", active);
    return this.options.store.updateMetadata({ currentRevision: expectedRevision, page, idempotencyKey, fence: this.mutationFence(commitDecision, await this.observation(context, { ...snapshot, page }, impact, { state: "archived" }, active)) });
  }

  async reconcile(context: TContext, scope: WorkspacePageScope, signal?: AbortSignal): Promise<readonly WorkspacePageListItem[]> {
    const active = combineSignals(signal);
    await this.authorize(context, scope, "system.workspace-pages.edit", undefined, "reconcile", active);
    for (const page of await this.options.store.list(scope)) {
      if (page.state === "archived" || page.navigation.state !== "placed" || active.aborted) continue;
      const snapshot = await this.options.store.read(page.identity);
      if (!snapshot) continue;
      const impact = await this.impact(context, snapshot, active);
      const reason = impact.code === "plugin-removed" ? "parent-missing"
        : impact.code === "plugin-disabled" || impact.code === "plugin-quarantined" ? "parent-inactive" : undefined;
      if (reason === undefined) continue;
      const decision = await this.authorize(context, scope, "system.workspace-pages.edit", page.identity.pageId, "reconcile-page", active, false);
      if (!decision || await safeCall(() => this.options.acl.allows({ context, decision, snapshot, capability: "edit", signal: active })) !== true) continue;
      const reconciled: WorkspacePage = { ...snapshot.page, navigation: { state: "unplaced", reason }, revision: snapshot.page.revision + 1, updatedBy: decision.effectiveActor, updatedAt: iso(this.options.now) };
      const commitDecision = await this.authorize(context, scope, "system.workspace-pages.edit", page.identity.pageId, "reconcile-commit", active);
      await this.options.store.updateMetadata({
        currentRevision: snapshot.page.revision,
        page: reconciled,
        idempotencyKey: `workspace-reconcile-${snapshot.page.revision}-${impact.catalogRevision}`,
        fence: this.mutationFence(commitDecision, await this.observation(context, { ...snapshot, page: reconciled }, impact, { navigation: reconciled.navigation }, active))
      });
    }
    return this.list(context, scope, active);
  }

  private async locate(scope: WorkspacePageScope, pageId: string): Promise<WorkspacePageSnapshot> {
    const snapshot = await this.options.store.readByPageId(scope, pageId).catch(() => undefined);
    if (!snapshot) failure("NOT_FOUND", "Workspace page is unavailable.");
    return snapshot;
  }

  private async authorizedSnapshot(context: TContext, scope: WorkspacePageScope, pageId: string, permissionId: string, operation: string, signal: AbortSignal, capability: "view" | "edit") {
    await this.pageAdmission(context, scope, permissionId, undefined, `${operation}-lookup`, signal);
    const snapshot = await this.locate(scope, pageId);
    if (snapshot.page.state === "archived") failure("NOT_FOUND", "Workspace page is unavailable.");
    const decision = await this.pageAdmission(context, scope, permissionId, snapshot.page.identity.pageId, operation, signal);
    if (await safeCall(() => this.options.acl.allows({ context, decision, snapshot, capability, signal })) !== true) failure("NOT_FOUND", "Workspace page is unavailable.");
    return { snapshot, decision };
  }

  private async pageAdmission(context: TContext, scope: WorkspacePageScope, permissionId: string, pageId: string | undefined, operation: string, signal: AbortSignal): Promise<AuthorizationDecision> {
    try { return await this.authorize(context, scope, permissionId, pageId, operation, signal); }
    catch { failure("NOT_FOUND", "Workspace page is unavailable."); }
  }

  private async impact(context: TContext, snapshot: WorkspacePageSnapshot, signal: AbortSignal): Promise<WorkspacePageImpact> {
    const result = await safeCall(() => this.options.catalog.impact({ context, snapshot, ...(snapshot.publication ? { revision: snapshot.publication.revision } : {}), signal }));
    const fallback: WorkspacePageImpact = Object.freeze({ state: "dependency-unavailable", catalogRevision: 0, dependencyDigest: (snapshot.page.dependencyDigest ?? sha256([])) as `sha256:${string}`, code: "source-unavailable" });
    if (!result || !Number.isSafeInteger(result.catalogRevision) || result.catalogRevision < 0 || !/^sha256:[0-9a-f]{64}$/u.test(result.dependencyDigest)) return fallback;
    const key = canonicalJson([snapshot.page.identity.applicationId, snapshot.page.identity.environment, snapshot.page.identity.pageId, result.dependencyDigest]);
    const previous = this.impacts.get(key);
    if (previous && (result.catalogRevision < previous.catalogRevision || result.catalogRevision === previous.catalogRevision && canonicalJson(result) !== canonicalJson(previous))) return previous.state === "dependency-unavailable" ? previous : fallback;
    const current = Object.freeze(result);
    this.impacts.set(key, current);
    return current;
  }

  private project(snapshot: WorkspacePageSnapshot, impact: WorkspacePageImpact, capability: "view" | "edit"): WorkspacePageDetail {
    return Object.freeze({
      page: snapshot.page,
      impact,
      ...(snapshot.publication ? { publication: snapshot.publication } : {}),
      ...(capability === "edit" ? { workingCopy: snapshot.workingCopy } : {})
    });
  }

  private async observation(context: TContext, snapshot: WorkspacePageSnapshot, impact: WorkspacePageImpact, exact: unknown, signal: AbortSignal, revision?: WorkspacePublishedRevision): Promise<WorkspacePageCatalogObservation> {
    const observed = await safeCall(() => this.options.catalog.observe({ context, snapshot, ...(revision === undefined ? {} : { revision }), signal }));
    if (!observed || signal.aborted) failure("DEPENDENCY_UNAVAILABLE", "Workspace page dependency observation is unavailable.");
    const extensions = [...observed.extensionGenerations].sort((left, right) => canonicalJson([left.deliveryClass, left.extensionId]).localeCompare(canonicalJson([right.deliveryClass, right.extensionId])));
    if (extensions.length > 128 || new Set(extensions.map((value) => canonicalJson([value.deliveryClass, value.extensionId]))).size !== extensions.length ||
      extensions.some((value) => value.applicationId !== snapshot.page.identity.applicationId)) {
      failure("DEPENDENCY_UNAVAILABLE", "Workspace page extension observation is invalid.");
    }
    const theme = observed.themePublication;
    const selectedTheme = snapshot.page.themeProfile;
    if (selectedTheme !== undefined && theme === undefined || theme !== undefined && (theme.applicationId !== snapshot.page.identity.applicationId || theme.environment !== snapshot.page.identity.environment ||
      selectedTheme !== undefined && (theme.profileId !== selectedTheme.profileId || theme.activeRevisionId !== selectedTheme.revisionId))) {
      failure("DEPENDENCY_UNAVAILABLE", "Workspace page theme observation is invalid.");
    }
    const extensionGenerations = Object.freeze(extensions.map((value) => Object.freeze({ ...value })));
    const themePublication = theme === undefined ? undefined : Object.freeze({ ...theme });
    return Object.freeze({
      catalogRevision: impact.catalogRevision,
      catalogDigest: sha256({ impact, exact, extensionGenerations, themePublication: themePublication ?? null }),
      extensionGenerations,
      ...(themePublication === undefined ? {} : { themePublication })
    });
  }

  private mutationFence(decision: AuthorizationDecision, observation: WorkspacePageCatalogObservation): WorkspacePageMutationFence {
    if (observation.catalogRevision !== decision.lifecycleRevision) failure("REVISION_CONFLICT", "Workspace page catalog observation is stale.");
    return issueWorkspacePageMutationFence({
      applicationId: decision.applicationId,
      environment: decision.environment,
      authorizationRevision: decision.authorizationRevision,
      lifecycleRevision: decision.lifecycleRevision,
      catalogRevision: observation.catalogRevision,
      catalogDigest: observation.catalogDigest,
      extensionGenerations: observation.extensionGenerations,
      ...(observation.themePublication === undefined ? {} : { themePublication: observation.themePublication }),
      authorityDigest: sha256(decision)
    });
  }

  private async authorize(context: TContext, scope: WorkspacePageScope, permissionId: string, pageId: string | undefined, operation: string, signal: AbortSignal): Promise<AuthorizationDecision>;
  private async authorize(context: TContext, scope: WorkspacePageScope, permissionId: string, pageId: string | undefined, operation: string, signal: AbortSignal, required: false): Promise<AuthorizationDecision | undefined>;
  private async authorize(context: TContext, scope: WorkspacePageScope, permissionId: string, pageId: string | undefined, operation: string, signal: AbortSignal, required = true): Promise<AuthorizationDecision | undefined> {
    if (signal.aborted) failure("ACCESS_DENIED", "Workspace page operation was revoked.");
    const target = createCurrentAuthorityTarget({
      permissionId,
      scope: { kind: "application", resource: "system.workspace-pages" },
      facts: { boundary: "workspace-page-service", operation, ...(pageId === undefined ? {} : { pageId }) }
    });
    const decision = await safeCall(() => this.options.authority.authorize(context, target, signal));
    const valid = decision?.outcome === "allow" && decision.applicationId === scope.applicationId && decision.environment === scope.environment && decision.permissionId === permissionId;
    if (!valid && required) failure("ACCESS_DENIED", "Current authority denied the workspace page operation.");
    return valid ? decision : undefined;
  }
}

/** Explicit ACL policy: page access intersects role membership; owner override is a supplied durable fact, never a label check. */
export class ExactWorkspacePageAclPolicy<TContext> implements WorkspacePageAclPolicy<TContext> {
  constructor(private readonly facts: (input: Readonly<{ context: TContext; decision: AuthorizationDecision; signal: AbortSignal }>) => Promise<Readonly<{ roleIds: readonly string[]; ownerOverride: boolean }>>) {}

  async allows(input: Parameters<WorkspacePageAclPolicy<TContext>["allows"]>[0]): Promise<boolean> {
    if (input.signal.aborted) return false;
    const facts = await this.facts({ context: input.context, decision: input.decision, signal: input.signal });
    if (input.signal.aborted) return false;
    if (facts.ownerOverride) return true;
    const actor = input.decision.effectiveActor;
    return input.snapshot.access.assignments.some((assignment) => {
      const subjectMatches = assignment.subject.kind === "user" ? actor.kind === "user" && assignment.subject.userId === actor.id : facts.roleIds.includes(assignment.subject.roleId);
      return subjectMatches && (input.capability === "view" || assignment.capability === "edit");
    });
  }

  async allowsReplacement(input: Parameters<WorkspacePageAclPolicy<TContext>["allowsReplacement"]>[0]): Promise<boolean> {
    if (!await this.allows({ ...input, capability: "edit" })) return false;
    const facts = await this.facts({ context: input.context, decision: input.decision, signal: input.signal });
    if (facts.ownerOverride) return true;
    const actor = input.decision.effectiveActor;
    return input.assignments.every((assignment) => assignment.capability !== "edit" ||
      (assignment.subject.kind === "user" ? actor.kind === "user" && assignment.subject.userId === actor.id : facts.roleIds.includes(assignment.subject.roleId)));
  }
}
