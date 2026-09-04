import { describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

describe("generated workspace invalidation runtime", () => {
  it("keeps a navigation-only user from Sales Settings by matching direct route admission predicates", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const navigation = files["src/k-nex-workspace-navigation.ts"]!;
    const routes = files["src/k-nex-sales-routes.ts"]!;

    expect(navigation).toContain('implementedSystemRouteIds: ["system.route.workspace", "system.route.workspace-pages"]');
    expect(navigation).toContain('import { canonicalJson, type PluginNavigationDescriptor, type PluginRouteDescriptor } from "@k-nex/contracts";');
    expect(navigation).toContain("routes.map(({ value }) => value as RegisteredRoute)");
    expect(navigation).toContain("const salesGenerationCurrent = state.lifecycleRevision === kNexSalesRegistry.authorizationGeneration.lifecycleRevision");
    expect(navigation).toContain("kNexSalesRegistry.scopedRegistration.contributions.routes.map(({ value }) => value as RegisteredRoute)");
    expect(navigation).toContain("kNexSalesRegistry.scopedRegistration.contributions.navigation.map(async ({ value }) => {");
    expect(navigation).toContain("const template = templates.find((candidate) => candidate.id === route?.viewId);");
    expect(navigation).toContain('route?.ownerPluginId !== "module.sales" || template?.ownerPluginId !== "module.sales" || template.route.routeId !== route.id');
    expect(navigation).toContain("authorizeNavigationPermission(payload, context, route.permission)");
    expect(navigation).toContain("authorizeNavigationPermission(payload, context, template.permission)");
    expect(navigation).toContain("return routeAllowed && templateAllowed ? descriptor : undefined;");
    expect(navigation).toContain("navigation: salesNavigation");
    expect(routes).toContain("if (!await authorizeNavigationPermission(payload, context, route.permission) || !await authorizeNavigationPermission(payload, context, template.permission)) {");
    expect(navigation).toContain("...kNexSalesRegistry.navigationSection");
    expect(navigation).toContain("if (!salesGenerationCurrent) return [];");
    expect(files["src/app/(workspace)/sales/[[...path]]/page.tsx"]).toBeUndefined();
    expect(files["src/app/(workspace)/system/[[...path]]/page.tsx"]).toBeUndefined();
    expect(JSON.stringify(files)).not.toContain("Registered workspace route.");
  });

  it("generates only four registered Sales pages with current authority and registered actions", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const routes = [
      ["src/app/(workspace)/sales/page.tsx", "sales.route.overview"],
      ["src/app/(workspace)/sales/tasks/page.tsx", "sales.route.tasks"],
      ["src/app/(workspace)/sales/opportunities/page.tsx", "sales.route.opportunities"],
      ["src/app/(workspace)/sales/settings/page.tsx", "sales.route.settings"]
    ] as const;
    const runtime = files["src/k-nex-sales-routes.ts"]!;
    const client = files["src/app/components/k-nex-sales-route-runtime.tsx"]!;
    const action = files["src/app/api/k-nex/sales/actions/[actionId]/route.ts"]!;
    const readiness = files["src/k-nex-readiness.ts"]!;

    expect(routes.map(([path]) => files[path]).filter(Boolean)).toHaveLength(4);
    for (const [path, routeId] of routes) {
      expect(files[path]).toContain(`loadRegisteredSalesRoute(payload, context, ${JSON.stringify(routeId)})`);
      expect(files[path]).toContain("kNexRequestContext(headers");
    }
    expect(files["src/app/(workspace)/sales/[...path]/page.tsx"]).toBeUndefined();
    expect(runtime).toContain("kNexSalesRegistry.scopedRegistration.contributions.pageTemplates");
    expect(runtime).toContain("state.lifecycleRevision !== kNexSalesRegistry.authorizationGeneration.lifecycleRevision");
    expect(runtime).toContain("authorizeNavigationPermission(payload, context, route.permission)");
    expect(runtime).toContain("authorizeNavigationPermission(payload, context, template.permission)");
    expect(runtime).toContain("loadWorkspaceSalesSources(payload, context, template.document");
    expect(runtime).toContain("executeWorkspaceSalesAction(payload, context, registeredAction(actionId)");
    expect(runtime).not.toContain("openWorkspacePageSession");
    expect(client).toContain("createUiDocumentRuntime(createUiRuntimeRegistry");
    expect(client).toContain('fetch("/api/k-nex/sales/actions/" + encodeURIComponent(request.action.id)');
    expect(action).toContain("executeRegisteredSalesRouteAction");
    expect(action).toContain("request.signal");
    expect(readiness).toContain('"src/app/(workspace)/sales/page.tsx"');
    expect(readiness).toContain('"src/app/api/k-nex/sales/actions/[actionId]/route.ts"');
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
