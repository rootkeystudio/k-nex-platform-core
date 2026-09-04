import { describe, expect, it } from "vitest";

import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

type GeneratedEditorSession = Readonly<{
  persistence: Readonly<{
    autosave(input: unknown): Promise<unknown>;
    publish(input: unknown): Promise<unknown>;
    rollback(input: unknown): Promise<unknown>;
  }>;
}>;

function strictModeGeneratedEditorSession(source: string): Readonly<{ session: GeneratedEditorSession; mutationSignals: AbortSignal[] }> {
  const effects: (() => (() => void) | void)[] = [];
  const hooks: unknown[] = [];
  const mutationSignals: AbortSignal[] = [];
  let hook = 0;
  let session: GeneratedEditorSession | undefined;
  const watermark = { authorizationRevision: 1, lifecycleRevision: 1, pageRevision: 1, accessRevision: 1, publicationPointerRevision: 1, publicationRevisionId: "workspace.revision.1", themePublicationRevision: 1, themeActiveRevisionId: "workspace.theme.initial", themeStateDigest: `sha256:${"1".repeat(64)}` };
  const useState = <T,>(initial?: T) => [initial, () => undefined] as const;
  const useRef = <T,>(initial: T) => {
    const index = hook++;
    hooks[index] ??= { current: initial };
    return hooks[index] as { current: T };
  };
  const useEffect = (setup: () => (() => void) | void) => { effects.push(setup); };
  const useMemo = <T,>(factory: () => T) => factory();
  class WorkspaceEditorSession {
    constructor(options: GeneratedEditorSession) { session = options; }
  }
  const executable = source
    .replace(/^import .*\n/gmu, "")
    .replace(/^type .*\n/gmu, "")
    .replace(/function watermark\(value: unknown\): Watermark \| undefined/u, "function watermark(value)")
    .replace(/const candidate = value as Record<string, unknown>;/u, "const candidate = value;")
    .replace(/return candidate as Watermark;/u, "return candidate;")
    .replace(/function sameEditorAuthority\(left: Watermark, right: Watermark\): boolean/u, "function sameEditorAuthority(left, right)")
    .replace(/export function WorkspacePageEditor\(\{ pageId, initialProjection \}: Readonly<\{ pageId: string; initialProjection: Projection \}>\) \{/u, "function WorkspacePageEditor({ pageId, initialProjection }) {")
    .replace(/useState<"access" \| "authority" \| undefined>\(\)/u, "useState()")
    .replace(/\(reason: "access" \| "authority"\)/u, "(reason)")
    .replace(/\) as \{ watermark\?: unknown \} \| undefined/u, ")")
    .replace(/  if \(unavailable === "access"\) return <section[^\n]*\n/u, "")
    .replace(/  if \(unavailable === "authority"\) return <section[^\n]*\n/u, "")
    .replace(/  return <WorkspacePuckEditorHost[^\n]*\/>;\n/u, "  return session;\n");
  const WorkspacePageEditor = new Function("useState", "useRef", "useEffect", "useMemo", "WorkspaceEditorSession", "createAuthorizedPuckBuilderProfile", "WorkspacePuckEditorHost", "presentUiRuntimeReact", "genericPuckBlockBridges", "salesPuckBlockBridges", "salesOpportunitiesDescriptor", "salesTasksDescriptor", "salesTotalPotentialRevenueDescriptor", "fetch", "crypto", `${executable}\nreturn WorkspacePageEditor;`)(
    useState, useRef, useEffect, useMemo, WorkspaceEditorSession, () => ({}), () => undefined, () => undefined, [], [], {}, {}, {},
    async (_input: string, init?: Readonly<{ method?: string; signal?: AbortSignal }>) => {
      if (init?.method === "POST" && init.signal !== undefined) mutationSignals.push(init.signal);
      return { ok: true, status: 200, json: async () => ({ watermark }) };
    }, crypto
  ) as (input: { pageId: string; initialProjection: Record<string, unknown> }) => unknown;

  hook = 0;
  WorkspacePageEditor({ pageId: "workspace.page.1", initialProjection: { authority: {}, permissions: [], workingCopy: {}, rollbackRevisions: [], watermark } });
  const setup = effects[0];
  if (setup === undefined) throw new TypeError("Generated editor did not register a synchronization effect.");
  const cleanup = setup();
  cleanup?.();
  setup();
  if (session === undefined) throw new TypeError("Generated editor did not create an editor session.");
  return { session, mutationSignals };
}

describe("generated workspace page builder policy", () => {
  it("limits generated System workspace-page navigation to its implemented route", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const sources = [
      files["src/app/(workspace)/system/workspace-pages/page.tsx"]!,
      files["src/app/(workspace)/system/workspace-pages/[pageId]/page.tsx"]!
    ];

    for (const source of sources) {
      expect(source).toContain('navigation: [{ id: "workspace-pages", label: "Workspace pages", href: "/system/workspace-pages" }],');
      expect(source.match(/navigation: \[/gu)).toHaveLength(1);
      expect(source).not.toMatch(/href: "\/system\/(?:access\/(?:roles|permissions|assignments|templates|audit)|extensions|themes|settings|operations)"/u);
    }
  });

  it("routes folder mutations through a server-derived authority fence and static catalog", () => {
    const runtime = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-workspace-pages.ts"]!;

    expect(runtime).toContain('permissionId: "system.workspace-pages.edit"');
    expect(runtime).toContain('decision.effectiveActor.kind !== "user"');
    expect(runtime).toContain('state.authorizationRevision !== decision.authorizationRevision || state.lifecycleRevision !== decision.lifecycleRevision');
    expect(runtime).toContain("async function folderCatalog(payload: Payload)");
    expect(runtime).toContain("await currentSalesGeneration(payload).catch(() => undefined)");
    expect(runtime).toContain('staticNodes: workspaceNavigationFixedNodes, staticParentIds: []');
    expect(runtime).toContain("scopedRegistration.contributions.navigation.map");
    expect(runtime).toContain('ownerPluginId: "module.sales", routeId');
    expect(runtime).toContain("staticNodes: [...workspaceNavigationFixedNodes, section, ...children]");
    expect(runtime).toContain("staticParentIds: [section.id]");
    expect(runtime).toContain('runtime.folders.create(scope, node, decision.effectiveActor, fence, catalog)');
    expect(runtime).toContain('runtime.folders.update(scope, { ...existing.node, label: input.label, parentId: input.parentNavigationId, order: input.order }, input.expectedRevision, decision.effectiveActor, fence, catalog)');
    expect(runtime).not.toContain("Workspace folder move creates a cycle.");
  });

  it("injects a server-owned Puck validator built from current registered authority", () => {
    const source = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-workspace-pages.ts"]!;

    expect(source).toContain('import { createAuthorizedPuckBuilderProfile } from "@k-nex/builder-puck";');
    expect(source).toContain('import { salesPuckBlockBridges } from "@k-nex/module-sales/puck";');
    expect(source).toContain('import { genericPuckBlockBridges } from "@k-nex/ui-builder-blocks";');
    expect(source).toContain('import { genericUiBlockDefinitions } from "@k-nex/ui-builder-blocks/runtime";');
    expect(source).toContain('blocks: [...genericPuckBlockBridges, ...salesPuckBlockBridges.filter');
    expect(source).toContain('const platformBlocks = new Map(genericUiBlockDefinitions.map');
    expect(source).toContain("kNexSalesRegistry.scopedRegistration.contributions[kind]");
    expect(source).toContain("workspaceSalesPermissions(payload, context, signal)");
    expect(source).toContain("function workspaceDocumentValidator(payload: Payload): WorkspacePageDocumentValidator<KnexRequestContext>");
    expect(source).toContain("documents: workspaceDocumentValidator(payload)");
    expect(source).toContain("profile.validateChange(previous, { ...document, version: previous.version })");
    expect(source).toContain("return profile.validateDocument(document)");
    expect(source).toContain(".validateDocument(document)");
  });

  it("observes compiled Sales only for the selected document's executable dependencies", () => {
    const runtime = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-workspace-pages.ts"]!;

    expect(runtime).toContain("function usesSales(document: UiDocument): boolean {");
    expect(runtime).toContain("const document = selected?.document ?? snapshot.workingCopy.document;");
    expect(runtime).toContain("const pluginCode = usesSales(document) ? await salesGenerationImpact(payload, state?.lifecycleRevision) : undefined;");
    expect(runtime).toContain("const document = revision?.document ?? snapshot.workingCopy.document;");
    expect(runtime).toContain("extensionGenerations: Object.freeze(usesSales(document) ? [{ applicationId: scope.applicationId");
    expect(runtime).toContain("authorization_generation=$3 and runtime_generation_ids=$4::jsonb");
    expect(runtime).toContain("canonicalJson([kNexSalesRegistry.staticRelease.runtimeGenerationId])");
    expect(runtime).toContain("await currentSalesGeneration(payload).catch(() => undefined)");
    expect(runtime).not.toContain("lifecycleRevision !== kNexSalesRegistry.authorizationGeneration.lifecycleRevision");
  });

  it("uses the runtime-only built-in definitions for generated production pages", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const runtime = files["src/app/components/k-nex-workspace-page-runtime.tsx"]!;
    const editor = files["src/app/components/k-nex-workspace-page-editor.tsx"]!;

    expect(runtime).toContain('import { genericUiBlockDefinitions } from "@k-nex/ui-builder-blocks/runtime";');
    expect(runtime).toContain('blocks: [...genericUiBlockDefinitions, ...salesUiBlockDefinitions]');
    expect(runtime).not.toContain("builder-puck");
    expect(runtime).not.toContain("PuckBlock");
    expect(editor).toContain('blocks: [...genericPuckBlockBridges, ...salesPuckBlockBridges]');
  });

  it("derives the workspace owner override from the revision-pinned active owner assignment", () => {
    const source = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-workspace-pages.ts"]!;

    expect(source).toContain('const assignments = (await authority.store.readTransaction(expected, (transaction) => transaction.listAssignments(scope.applicationId, decision.effectiveActor))).value;');
    expect(source).toContain('assignments.some((assignment) => assignment.roleId === "system.role.owner" && assignment.state === "active")');
    expect(source).not.toContain("readProtectedRoleBaselineReceipt");
  });

  it("uses one current-authority bounded subject projection for page ACL selection and validation", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const runtime = files["src/k-nex-workspace-pages.ts"]!;
    const detail = files["src/app/(workspace)/system/workspace-pages/[pageId]/page.tsx"]!;
    const mutation = files["src/app/api/k-nex/workspace-pages/[pageId]/[operation]/route.ts"]!;

    expect(runtime).toContain('export async function loadWorkspacePageAccessSubjects(payload: Payload, context: KnexRequestContext)');
    const accessAuthorization = 'authorizeRequest(payload, context, "system.workspace-pages.access.manage", "system.workspace-pages")';
    const initialAuthorization = runtime.indexOf(accessAuthorization);
    const finalAuthorization = runtime.lastIndexOf(accessAuthorization);
    expect(runtime.split(accessAuthorization)).toHaveLength(3);
    expect(runtime.indexOf("const state = await authority.store.readState(scope.applicationId, scope.environment);")).toBeLessThan(initialAuthorization);
    expect(runtime).toContain('readTransaction(expected, (transaction) => transaction.listRoles(scope.applicationId))');
    expect(initialAuthorization).toBeLessThan(runtime.indexOf('readTransaction(expected, (transaction) => transaction.listRoles(scope.applicationId))'));
    expect(runtime).toContain('collection: "users", overrideAccess: true, depth: 0, limit: 501, pagination: false, select: { email: true }, sort: "id"');
    expect(runtime).toContain('if (result.docs.length > 500 || result.totalDocs > 500) throw new TypeError("Workspace access subject ceiling exceeded.");');
    expect(runtime).toContain('const current = await authority.store.readState(scope.applicationId, scope.environment);');
    expect(runtime).toContain('current.authorizationRevision !== expected.authorizationRevision || current.lifecycleRevision !== expected.lifecycleRevision');
    expect(finalAuthorization).toBeGreaterThan(runtime.indexOf('const current = await authority.store.readState(scope.applicationId, scope.environment);'));
    expect(runtime).toContain('const finalState = await authority.store.readState(scope.applicationId, scope.environment);');
    expect(runtime).toContain('finalState.authorizationRevision !== expected.authorizationRevision || finalState.lifecycleRevision !== expected.lifecycleRevision');
    expect(runtime.indexOf('const finalState = await authority.store.readState(scope.applicationId, scope.environment);')).toBeGreaterThan(finalAuthorization);
    expect(runtime).toContain('result.docs.slice(0, 500).map(({ id, email }) =>');
    expect(runtime).toContain('return Object.freeze({ id: String(id), displayEmail: email });');
    expect(detail).toContain('loadWorkspacePageAccessSubjects(payload, context).catch(() => undefined)');
    expect(detail).toContain('subjects?.users ?? []');
    expect(detail).not.toContain('payload.find({ collection: "users"');
    expect(mutation).toContain('const subjects = await loadWorkspacePageAccessSubjects(payload, context);');
    expect(mutation).toContain('new Set(subjects.roles.map(({ id }) => id))');
    expect(mutation).toContain('new Set(subjects.users.map(({ id }) => id))');
    expect(mutation).not.toContain('payload.find({ collection: "users"');
  });

  it("emits only a page-scoped Sales action route with current page and action authority", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const client = files["src/app/components/k-nex-workspace-page-runtime.tsx"]!;
    const route = files["src/app/api/k-nex/workspace-pages/[pageId]/actions/[actionId]/route.ts"]!;
    const sales = files["src/k-nex-sales-workspace.ts"]!;

    expect(files["src/app/api/k-nex/sales/actions/[actionId]/route.ts"]).toBeUndefined();
    expect(client).toContain('"/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/actions/"');
    expect(route).toContain('openWorkspacePageSession(payload, context, pageId, "view", context.correlationId)');
    expect(route).toContain('detail.page.state !== "published" || detail.impact.state !== "ready" || detail.publication === undefined');
    expect(route).toContain("function boundAction(document: UiDocument, actionId: string)");
    expect(route).toContain("node.children?.forEach(visit)");
    expect(route).toContain("if (action === undefined) return notFound();");
    expect(route).toContain("return Response.json({ code: \"NOT_FOUND\" }, { status: 404");
    expect(route.indexOf('openWorkspacePageSession(payload, context, pageId, "view", context.correlationId)')).toBeLessThan(route.indexOf("Workspace Sales action body is invalid."));
    expect(route).toContain('import { executeWorkspaceSalesAction }');
    expect(route).toContain('import { openWorkspacePageSession }');
    expect(sales).toContain("new RegisteredActionGateway(kNexSalesRegistry.scopedRegistration");
    expect(sales).toContain("new CurrentAuthorityActionGatewayPolicy(kNexAuthority(payload).adapter");
    expect(sales).not.toContain("salesOpportunityStageUpdateHandler");
    expect(sales).not.toContain("kNexWorkspacePages");
  });

  it("routes every generated workspace Sales source through the current-authority gateway", () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;

    expect(sales).toContain("new DataSourceGateway({");
    expect(sales).toContain("new CurrentAuthorityDataSourcePolicy(");
    expect(sales).toContain("kNexSalesRegistry.scopedRegistration.contributions.sources");
    expect(sales).toContain("kNexSalesRegistry.scopedRegistration.bindings.sources");
    expect(sales).toContain("const workspaceSalesBudget = new BoundedQueryBudgetEvaluator();");
    expect(sales).toContain("budget: workspaceSalesBudget,");
    expect(sales).not.toContain("budget: new BoundedQueryBudgetEvaluator()");
    expect(sales).toContain('source: (descriptor) => target(descriptor.permission)');
    expect(sales).toContain('field: (descriptor, fieldId) => {');
    expect(sales).toContain('state: response.body.code === "INSUFFICIENT_FIELD_PERMISSION" ? "insufficient-permission" : "forbidden"');
    expect(sales).toContain('if (response.status === 429) {');
    expect(sales).toContain('state: "rate-limited", problem: { code: response.body.code, status: 429 }');
    expect(sales).toContain('recordScope = descriptor.id === "sales.opportunities"');
    expect(sales).toContain("for (const node of sourceNodes(document))");
    expect(sales).not.toContain("salesOpportunitiesHandler");
    expect(sales).not.toContain("salesTasksHandler");
    expect(sales).not.toContain("salesTotalPotentialRevenueHandler");
    expect(sales).not.toContain("const permissions = [descriptor.permission");
  });

  it("revalidates a page snapshot and fails projections closed when the current Sales watermark changes", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const page = files["src/app/components/k-nex-workspace-page-runtime.tsx"]!;
    const editor = files["src/app/components/k-nex-workspace-page-editor.tsx"]!;
    const route = files["src/app/api/k-nex/workspace-pages/[pageId]/session/route.ts"]!;
    const runtime = files["src/k-nex-workspace-pages.ts"]!;

    expect(page).toContain("initialProjection");
    expect(page).toContain("sameWatermark(current.watermark, nextWatermark)");
    expect(page).toContain("setCurrent(next)");
    expect(page).toContain("setRevoked(true)");
    expect(page).toContain("setRevoked(false)");
    expect(editor).toContain("/session?mode=edit");
    expect(editor).toContain("function sameEditorAuthority(left: Watermark, right: Watermark): boolean {");
    expect(editor).toContain("left.themePublicationRevision === right.themePublicationRevision");
    expect(editor).toContain("const currentWatermark = useRef(initialProjection.watermark);");
    expect(editor).toContain("for (let confirmation = 0; response?.status === 404 && confirmation < 2; confirmation += 1)");
    expect(editor).toContain("await new Promise((resolveWait) => setTimeout(resolveWait, 100));");
    expect(editor).toContain("if (response === undefined || response.status === 409) return;");
    expect(editor).toContain('if (!response.ok) return failClosed("access");');
    expect(editor).toContain('if (!sameEditorAuthority(currentWatermark.current, next)) return failClosed("authority");');
    expect(editor).toContain("currentWatermark.current = next;");
    expect(editor).not.toContain('if (!sameWatermark(initialProjection.watermark, next)) failClosed("authority");');
    expect(editor).toContain("Editor authority changed");
    expect(route).toContain("loadWorkspacePageViewProjection");
    expect(route).toContain("loadWorkspacePageEditorProjection");
    expect(route).toContain('requestedWatermark(new URL(request.url).searchParams.get("watermark"))');
    expect(route).toContain("readWorkspacePageWatermark");
    expect(route).toContain('requested !== undefined && (mode === "edit" || sameWatermark(requested, watermark))');
    expect(route).toContain('Response.json({ watermark: projection.watermark, projection }');
    expect(route).toContain('["Workspace page session authority changed.", "Workspace page session was invalidated."].includes(error.message)');
    expect(route).toContain('Response.json({ code: "REVISION_CONFLICT" }, { status: 409');
    expect(route).toContain('Response.json({ code: "NOT_FOUND" }, { status: 404');
    expect(runtime).toContain("publicationPointerRevision");
    expect(runtime).toContain("readWorkspacePageWatermark");
    expect(runtime).toContain("const initialState = await runtime.synchronizeInvalidations();");
    expect(runtime.indexOf("const initialState = await runtime.synchronizeInvalidations();")).toBeLessThan(runtime.indexOf("const detail = await runtime.service.detail(context, scope, pageId, capability);"));
    expect(runtime.indexOf("const state = await runtime.synchronizeInvalidations();")).toBeGreaterThan(runtime.indexOf("const detail = await runtime.service.detail(context, scope, pageId, capability);"));
    expect(runtime).toContain("if (initialState.authorizationRevision !== state.authorizationRevision || initialState.lifecycleRevision !== state.lifecycleRevision) throw new TypeError(\"Workspace page session authority changed.\");");
    expect(runtime).toContain("if (session.signal.aborted) { session.close(); throw new TypeError(\"Workspace page session was invalidated.\"); }");
    expect(runtime).toContain("loadWorkspaceSalesSources(payload, context, document, session.signal)");
    expect(runtime).toContain("Workspace page projection was invalidated.");
  });

  it("keeps generated development-editor mutations live after the Strict Mode setup-cleanup-setup probe", async () => {
    const editor = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/app/components/k-nex-workspace-page-editor.tsx"]!;
    const { session, mutationSignals } = strictModeGeneratedEditorSession(editor);

    await session.persistence.autosave({});
    await session.persistence.publish({});
    await session.persistence.rollback({});

    expect(mutationSignals).toHaveLength(3);
    expect(mutationSignals.every((signal) => !signal.aborted)).toBe(true);
  });
});
