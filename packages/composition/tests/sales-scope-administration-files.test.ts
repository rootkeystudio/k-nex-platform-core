import { describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";

describe("generated Sales scope administration", () => {
  it("ships one fixed, current-authority-gated, CAS and idempotent endpoint", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const source = files["src/k-nex-sales-scope-administration.ts"]!;
    const route = files["src/app/api/k-nex/sales/authority-scopes/route.ts"]!;

    expect(route).toContain('openWorkspaceJson(request, "sales-scope-administration")');
    expect(route).toContain("changeSalesAuthorityScope");
    expect(source).toContain('authorizeRequest(payload, context, "sales.settings.write", "sales.settings")');
    expect(source.indexOf('select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1 for update')).toBeLessThan(source.indexOf('authorizeRequest(payload, context, "sales.settings.write", "sales.settings")'));
    expect(source).toContain("record_scope !== \"application-sales-scope\"");
    expect(source).toContain("admin.state !== \"active\"");
    expect(source).toContain("g.permission_id='sales.settings.write'");
    expect(source).toContain("g.owner_extension_id='module.sales'");
    expect(source).toContain("x.state='current'");
    expect(source).toContain("sales_scope_administration_operations");
    expect(source).toContain("request_digest !== requestDigest");
    expect(source).toContain("Sales scope replay authority is unavailable.");
    expect(source).toContain("set state='revoked',revision=revision+1");
    expect(source).toContain("state='active',revision=sales_current_authority_scopes.revision+1");
    expect(source).toContain("authorization_revision=$2");
    expect(source).toContain("k_nex_authorization_audit");
    expect(source).toContain("AuthorizationDecisionAuditSchema.parse");
    expect(source).toContain('operation:"sales-scope-administration"');
    expect(source).toContain("k_nex_authorization_outbox");
    expect(source).toContain("begin");
    expect(source).toContain("commit");
    expect(source).toContain("rollback");
    expect(source).not.toContain("delete from sales_current_authority_scopes");
  });

  it("records bootstrap scope insertion in the same authorization revision convergence model", () => {
    const source = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-bootstrap-owner.ts"]!;

    expect(source).toContain("initial-sales-scope-audit");
    expect(source).toContain("initial-sales-scope-event");
    expect(source).toContain("authorizationOutboxEventId");
    expect(source).toContain("insert into k_nex_authorization_audit");
    expect(source).toContain("AuthorizationDecisionAuditSchema.parse");
    expect(source).toContain('operation: "initial-sales-scope"');
    expect(source).toContain("insert into k_nex_authorization_outbox");
    expect(source).toContain("for update");
    expect(source).toContain("authorization_revision=$2");
  });
});
