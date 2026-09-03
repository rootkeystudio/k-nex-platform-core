import { describe, expect, it } from "vitest";

import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

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

  it("injects a server-owned Puck validator built from current registered authority", () => {
    const source = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-workspace-pages.ts"]!;

    expect(source).toContain('import { createAuthorizedPuckBuilderProfile } from "@k-nex/builder-puck";');
    expect(source).toContain('import { salesPuckBlockBridges } from "@k-nex/module-sales/puck";');
    expect(source).toContain("kNexSalesRegistry.scopedRegistration.contributions[kind]");
    expect(source).toContain("workspaceSalesPermissions(payload, context, signal)");
    expect(source).toContain("function workspaceDocumentValidator(payload: Payload): WorkspacePageDocumentValidator<KnexRequestContext>");
    expect(source).toContain("documents: workspaceDocumentValidator(payload)");
    expect(source).toContain("profile.validateChange(previous, { ...document, version: previous.version })");
    expect(source).toContain("return profile.validateDocument(document)");
    expect(source).toContain(".validateDocument(document)");
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
    expect(editor).toContain("return left.authorizationRevision === right.authorizationRevision && left.lifecycleRevision === right.lifecycleRevision && left.accessRevision === right.accessRevision;");
    expect(editor).toContain("const currentWatermark = useRef(initialProjection.watermark);");
    expect(editor).toContain('if (!sameEditorAuthority(currentWatermark.current, next)) return failClosed("authority");');
    expect(editor).toContain("currentWatermark.current = next;");
    expect(editor).not.toContain('if (!sameWatermark(initialProjection.watermark, next)) failClosed("authority");');
    expect(editor).toContain("Editor authority changed");
    expect(route).toContain("loadWorkspacePageViewProjection");
    expect(route).toContain("loadWorkspacePageEditorProjection");
    expect(route).toContain('requestedWatermark(new URL(request.url).searchParams.get("watermark"))');
    expect(route).toContain("readWorkspacePageWatermark");
    expect(route).toContain('Response.json({ watermark: projection.watermark, projection }');
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
});
