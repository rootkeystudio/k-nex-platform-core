import { describe, expect, it } from "vitest";

import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

describe("generated workspace page builder policy", () => {
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
});
