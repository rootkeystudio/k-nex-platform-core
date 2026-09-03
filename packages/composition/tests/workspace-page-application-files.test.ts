import { describe, expect, it } from "vitest";

import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

describe("generated workspace page builder policy", () => {
  it("injects a server-owned Puck validator built from current registered authority", () => {
    const source = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-workspace-pages.ts"]!;

    expect(source).toContain('import { createAuthorizedPuckBuilderProfile } from "@k-nex/builder-puck";');
    expect(source).toContain('import { salesPuckBlockBridges } from "@k-nex/module-sales/puck";');
    expect(source).toContain("kNexSalesRegistry.scopedRegistration.contributions[kind]");
    expect(source).toContain("workspaceSalesPermissions(payload, context)");
    expect(source).toContain("function workspaceDocumentValidator(payload: Payload): WorkspacePageDocumentValidator<KnexRequestContext>");
    expect(source).toContain("documents: workspaceDocumentValidator(payload)");
    expect(source).toContain(".validateChange(previous, document)");
    expect(source).toContain(".validateDocument(document)");
  });
});
