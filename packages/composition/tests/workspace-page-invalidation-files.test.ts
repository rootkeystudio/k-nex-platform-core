import { describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

describe("generated workspace invalidation runtime", () => {
  it("generates only implemented System navigation and no catch-all workspace routes", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const navigation = files["src/k-nex-workspace-navigation.ts"]!;

    expect(navigation).toContain('implementedSystemRouteIds: ["system.route.workspace", "system.route.workspace-pages"]');
    expect(navigation).toContain("plugins: [{ ...kNexSalesRegistry.navigationSection, routes: [], navigation: [] }]");
    expect(files["src/app/(workspace)/sales/[[...path]]/page.tsx"]).toBeUndefined();
    expect(files["src/app/(workspace)/system/[[...path]]/page.tsx"]).toBeUndefined();
    expect(JSON.stringify(files)).not.toContain("Registered workspace route.");
  });

  it("dispatches both durable outboxes through one PostgreSQL channel", () => {
    const worker = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-worker.ts"]!;

    expect(worker).toContain("PostgresAuthorizationOutboxDispatcher");
    expect(worker).toContain("PostgresWorkspacePageOutboxDispatcher");
    expect(worker.match(/environment: kNexIdentity\.environment/g)).toHaveLength(2);
    expect(worker).toContain('pool.query("select pg_notify($1,$2)"');
    expect(worker).toContain('notify("authorization", invalidation, signal)');
    expect(worker).toContain('notify("workspace-page", invalidation, signal)');
  });

  it("refreshes an already-open sidebar from a server-owned authority watermark", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const navigation = files["src/k-nex-workspace-navigation.ts"]!;
    const shell = files["src/app/components/k-nex-workspace-shell.tsx"]!;
    const route = files["src/app/api/k-nex/navigation/revision/route.ts"]!;

    expect(navigation).toContain('const watermark = "sha256:" + createHash("sha256")');
    expect(navigation).toContain("authorizationRevision: state.authorizationRevision");
    expect(navigation).toContain("page.accessRevision");
    expect(route).toContain("resolveCurrentWorkspaceNavigation");
    expect(route).toContain('"cache-control": "no-store"');
    expect(shell).toContain('fetch("/api/k-nex/navigation/revision", { cache: "no-store" })');
    expect(route).toContain("navigation: resolved.navigation");
    expect(shell).toContain("setNavigation(body.navigation as ResolvedWorkspaceNavigation)");
    expect(shell).not.toContain("router.refresh()");
  });

  it("consumes validated notifications into one periodically reconciled session registry", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const runtime = files["src/k-nex-workspace-pages.ts"]!;
    const mutations = files["src/app/api/k-nex/workspace-pages/[pageId]/[operation]/route.ts"]!;
    const action = files["src/app/api/k-nex/workspace-pages/[pageId]/actions/[actionId]/route.ts"]!;

    expect(runtime).toContain('client.query("LISTEN k_nex_runtime_invalidation")');
    expect(runtime).toContain("parseWorkspacePageInvalidation(envelope.invalidation)");
    expect(runtime).toContain("const sessions = new WorkspacePageSessionRegistry()");
    expect(runtime).toContain("setInterval(() => { void synchronize().catch(() => undefined); }, 1_000)");
    expect(runtime).toContain("const state = await runtime.synchronizeInvalidations()");
    expect(runtime).toContain("runtime.sessions.open({ ...scope, pageId, sessionId");
    expect(mutations).toContain("openWorkspacePageSession(payload, context, pageId");
    expect(mutations).toContain("session.signal");
    expect(action).toContain("executeWorkspaceSalesAction(payload, context, action, value.input, value.idempotencyKey, session.signal)");
  });
});
