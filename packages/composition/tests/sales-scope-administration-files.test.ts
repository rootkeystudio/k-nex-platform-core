import { createHash } from "node:crypto";

import ts from "typescript";
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
    expect(source).toContain('canonicalJson([kNexIdentity.applicationId, "authorization-state"])');
    expect(source.indexOf('select pg_advisory_xact_lock(hashtextextended($1, 0))')).toBeLessThan(source.indexOf('select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1 for update'));
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
    expect(source).toContain('canonicalJson([kNexIdentity.applicationId, "authorization-state"])');
    expect(source.indexOf('select pg_advisory_xact_lock(hashtextextended($1, 0))')).toBeLessThan(source.indexOf('select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1 for update'));
    expect(source).toContain("authorization_revision=$2");
  });

  it("executes emitted scope writes under the shared authorization-state key before row locks and serializes competing writers", async () => {
    const source = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-sales-scope-administration.ts"]!;
    const body = source.slice(source.indexOf("type Scope ="));
    const executable = ts.transpileModule(`${body.replace("export async function", "async function")}\nreturn changeSalesAuthorityScope;`, { compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.None } }).outputText;
    let authorizationRevision = 1;
    let scopeRevision = 1;
    let holder = 0;
    const firstState = Promise.withResolvers<void>();
    const firstLocked = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    const trace: string[] = [];
    let connects = 0;
    const pool = {
      connect: async () => {
        const id = ++connects;
        return {
          query: async (text: string, values: readonly unknown[] = []) => {
            if (text === "begin") return { rows: [], rowCount: 0 };
            if (text.startsWith("select pg_advisory_xact_lock")) {
              trace.push(`${id}:lock:${String(values[0])}`);
              if (holder !== 0) { waiting.resolve(); while (holder !== 0) await new Promise((resolve) => setTimeout(resolve, 0)); }
              holder = id;
              if (id === 1) firstLocked.resolve();
              return { rows: [], rowCount: 0 };
            }
            if (text.startsWith("select authorization_revision,lifecycle_revision")) {
              trace.push(`${id}:state`);
              if (id === 1) await firstState.promise;
              return { rows: [{ authorization_revision: authorizationRevision, lifecycle_revision: 1 }], rowCount: 1 };
            }
            if (text.includes("sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 for update")) {
              return { rows: [{ revision: scopeRevision, state: "active", record_scope: "application-sales-scope", application_wide: true, mutation_allowed: true }], rowCount: 1 };
            }
            if (text.includes("k_nex_role_assignments")) return { rows: [{ ok: 1 }], rowCount: 1 };
            if (text.includes("sales_scope_administration_operations")) return { rows: [], rowCount: 0 };
            if (text.startsWith("insert into sales_current_authority_scopes")) { scopeRevision += 1; return { rows: [{ revision: scopeRevision }], rowCount: 1 }; }
            if (text.startsWith("update k_nex_authorization_state")) { authorizationRevision += 1; return { rows: [], rowCount: 1 }; }
            if (text === "commit") { holder = 0; return { rows: [], rowCount: 0 }; }
            if (text === "rollback") { holder = 0; return { rows: [], rowCount: 0 }; }
            return { rows: [], rowCount: 1 };
          },
          release: () => undefined
        };
      }
    };
    const change = new Function("createHash", "AuthorizationDecisionAuditSchema", "canonicalJson", "authorizeRequest", "currentPayloadAuthentication", "kNexIdentity", "kNexSalesRegistry", executable)(
      createHash, { parse: (value: unknown) => value }, JSON.stringify, async () => true, async () => ({ user: { id: "owner-1" } }),
      { applicationId: "customer-alpha", environment: "production" }, { authorizationGeneration: { owner: { generation: 1 } } }
    ) as (payload: unknown, context: unknown, input: unknown) => Promise<unknown>;
    const input = { operation: "upsert", principalId: "agent-1", idempotencyKey: "scope-write-1", expectedAuthorizationRevision: 1, expectedLifecycleRevision: 1, expectedScopeRevision: 1, recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [] };
    const payload = { db: { pool } };
    const first = change(payload, {}, input);
    await firstLocked.promise;
    const second = change(payload, {}, { ...input, idempotencyKey: "scope-write-2" });
    await waiting.promise;
    expect(trace).toContain(`1:lock:["customer-alpha","authorization-state"]`);
    expect(trace).toContain("1:state");
    expect(trace).toContain(`2:lock:["customer-alpha","authorization-state"]`);
    expect(trace).not.toContain("2:state");
    firstState.resolve();
    await expect(first).resolves.toMatchObject({ authorizationRevision: 2, scopeRevision: 2 });
    await expect(second).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(trace).toContain(`2:lock:["customer-alpha","authorization-state"]`);
    expect(trace.indexOf("1:lock:[\"customer-alpha\",\"authorization-state\"]")).toBeLessThan(trace.indexOf("1:state"));
    expect(trace.indexOf("2:lock:[\"customer-alpha\",\"authorization-state\"]")).toBeLessThan(trace.indexOf("2:state"));
  });
});
