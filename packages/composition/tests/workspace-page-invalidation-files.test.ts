import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

describe("generated workspace invalidation runtime", () => {
  it("uses record-aware current Sales permissions for route and template admission", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const navigation = files["src/k-nex-workspace-navigation.ts"]!;
    const routes = files["src/k-nex-sales-routes.ts"]!;

    expect(navigation).toContain('implementedSystemRouteIds: ["system.route.workspace", "system.route.roles", "system.route.permissions", "system.route.assignments", "system.route.extensions", "system.route.workspace-pages", "system.route.themes", "system.route.settings", "system.route.operations"]');
    expect(navigation).toContain('import { canonicalJson, type PluginNavigationDescriptor, type PluginRouteDescriptor } from "@k-nex/contracts";');
    expect(navigation).toContain("routes.map(({ value }) => value as RegisteredRoute)");
    expect(navigation).toContain("const salesAuthority = await currentSalesGeneration(payload).catch(() => undefined);");
    expect(navigation).toContain("const salesGenerationCurrent = salesAuthority !== undefined;");
    expect(navigation).toContain("kNexSalesRegistry.scopedRegistration.contributions.routes.map(({ value }) => value as RegisteredRoute)");
    expect(navigation).toContain("kNexSalesRegistry.scopedRegistration.contributions.navigation.map(async ({ value }) => {");
    expect(navigation).toContain("const template = templates.find((candidate) => candidate.id === route?.viewId);");
    expect(navigation).toContain('route?.ownerPluginId !== "module.sales" || template?.ownerPluginId !== "module.sales" || template.route.routeId !== route.id');
    expect(navigation).toContain("const salesPermissions = new Set(salesGenerationCurrent ? await workspaceSalesPermissions(payload, context) : []);");
    expect(navigation).toContain("permissions.has(route.permission)");
    expect(navigation).toContain("permissions.has(template.permission)");
    expect(navigation).toContain('permissionId.startsWith("sales.") ? Promise.resolve(salesPermissions.has(permissionId))');
    expect(navigation).toContain("navigation: salesNavigation");
    expect(routes).toContain("if (!permissions.includes(route.permission) || !permissions.includes(template.permission)) {");
    expect(navigation).toContain("...kNexSalesRegistry.navigationSection");
    expect(navigation).toContain("if (!salesGenerationCurrent) return [];");
    expect(files["src/app/(workspace)/sales/[[...path]]/page.tsx"]).toBeUndefined();
    expect(files["src/app/(workspace)/system/[[...path]]/page.tsx"]).toBeUndefined();
    expect(JSON.stringify(files)).not.toContain("Registered workspace route.");
  });

  it("generates fixed Sales workflow pages with safe detail parameters, current authority, and registered actions", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const listRoutes = [
      ["src/app/(workspace)/sales/page.tsx", "sales.route.overview"],
      ["src/app/(workspace)/sales/tasks/page.tsx", "sales.route.tasks"],
      ["src/app/(workspace)/sales/accounts/page.tsx", "sales.route.accounts"],
      ["src/app/(workspace)/sales/contacts/page.tsx", "sales.route.contacts"],
      ["src/app/(workspace)/sales/leads/page.tsx", "sales.route.leads"],
      ["src/app/(workspace)/sales/opportunities/page.tsx", "sales.route.opportunities"],
      ["src/app/(workspace)/sales/settings/page.tsx", "sales.route.settings"]
    ] as const;
    const detailRoutes = [
      ["src/app/(workspace)/sales/accounts/[id]/page.tsx", "sales.route.account-detail"],
      ["src/app/(workspace)/sales/contacts/[id]/page.tsx", "sales.route.contact-detail"],
      ["src/app/(workspace)/sales/leads/[id]/page.tsx", "sales.route.lead-detail"],
      ["src/app/(workspace)/sales/opportunities/[id]/page.tsx", "sales.route.opportunity-detail"]
    ] as const;
    const runtime = files["src/k-nex-sales-routes.ts"]!;
    const client = files["src/app/components/k-nex-sales-route-runtime.tsx"]!;
    const action = files["src/app/api/k-nex/sales/actions/[actionId]/route.ts"]!;
    const projection = files["src/app/api/k-nex/sales/routes/[routeId]/route.ts"]!;
    const readiness = files["src/k-nex-readiness.ts"]!;

    expect([...listRoutes, ...detailRoutes].map(([path]) => files[path]).filter(Boolean)).toHaveLength(11);
    for (const [path, routeId] of listRoutes) {
      expect(files[path]).toContain(`loadRegisteredSalesRoute(payload, context, ${JSON.stringify(routeId)}, undefined, Object.freeze({}), selection)`);
      expect(files[path]).toContain('kNexRequestContext(headers, "sales-route")');
    }
    for (const [path, routeId] of detailRoutes) {
      expect(files[path]).toContain('params: Promise<{ id: string }>');
      expect(files[path]).toContain("const routeParams = Object.freeze({ id: (await params).id });");
      expect(files[path]).toContain(`loadRegisteredSalesRoute(payload, context, ${JSON.stringify(routeId)}, routeParams, Object.freeze({}), selection)`);
      expect(files[path]).toContain("routeParams={routeParams}");
    }
    expect(files["src/app/(workspace)/sales/page.tsx"]).toContain('from "../../../k-nex-sales-routes.js"');
    expect(files["src/app/(workspace)/sales/tasks/page.tsx"]).toContain('from "../../../../k-nex-sales-routes.js"');
    expect(files["src/app/(workspace)/sales/accounts/[id]/page.tsx"]).toContain('from "../../../../../k-nex-sales-routes.js"');
    expect(files["src/app/(workspace)/sales/page.tsx"]).toContain('from "../../components/k-nex-sales-route-runtime.js"');
    expect(files["src/app/(workspace)/sales/tasks/page.tsx"]).toContain('from "../../../components/k-nex-sales-route-runtime.js"');
    expect(files["src/app/(workspace)/sales/[...path]/page.tsx"]).toBeUndefined();
    expect(runtime).toContain("kNexSalesRegistry.scopedRegistration.contributions.pageTemplates");
    expect(runtime).toContain(String.raw`expected.join("\0") !== "id"`);
    expect(runtime).toContain(String.raw`Object.keys(value).sort().join("\0") !== "id"`);
    expect(runtime).toContain('typeof value.id !== "string"');
    expect(runtime).toContain("214748364[0-7])$/u.test(value.id)");
    expect(runtime).toContain("currentSalesAuthorityGeneration(payload)");
    expect(runtime).toContain("permissions.includes(route.permission)");
    expect(runtime).toContain("permissions.includes(template.permission)");
    expect(runtime).toContain("const permissions = await workspaceSalesPermissions(payload, context);");
    expect(runtime).toContain("projectWorkspaceSalesDocument(payload, context, withDataMovementSelection(authorizedFixedDetailDocument(template.document, route.id, permissions), selection), permissions");
    expect(runtime).toContain("const listPage = routePage(pagination.listPage, 1_000_000)");
    expect(runtime).toContain("const timelinePage = routePage(pagination.timelinePage, 4)");
    expect(runtime).toContain("finalState.authorizationRevision !== initialState.authorizationRevision");
    expect(runtime).toContain("canonicalJson(finalPermissions) !== canonicalJson(permissions)");
    expect(runtime).toContain("permissions.includes(registered.descriptor.permission)");
    expect(runtime).toContain("if (!actionAllowed && node.bindings?.source === undefined) return [];");
    expect(runtime).toContain('routeId === "sales.route.opportunity-detail" && permissions.includes("sales.opportunities.amount.read") ? ["amount"]');
    expect(runtime).toContain("permissions: postReloadPermissions, routeId: route.id, routeParams: parameters, sourceResults: finalSourceResults, stateHistory, timeline");
    expect(runtime).toContain("permissions: postReloadPermissions, selection: Object.freeze");
    expect(runtime).toContain("projectSalesStateHistory({ audit: record.audit");
    expect(runtime).toContain("const expectedRevision = sourceResultRecordRevision(sourceResults[primaryNode.id], id)");
    expect(runtime).toContain('const select = Object.freeze({ id: true, applicationId: true, environment: true, revision: true, audit: true, ownerId: true, teamId: true, [state.field]: true, ...(dualAxis ? { archiveStatus: true } : {}) });');
    expect(runtime).toContain('select, where: { and: [{ id: { equals: id } }');
    expect(runtime).not.toContain('select: { amount: true');
    expect(runtime).toContain("{ revision: { equals: expectedRevision } }");
    expect(runtime).toContain("const initialRecord = primaryNode === undefined || parameters.id === undefined ? undefined : sourceResultRecord(sourceResults[primaryNode.id], parameters.id)");
    expect(runtime).toContain("canonicalJson(finalRecord) !== canonicalJson(initialRecord)");
    expect(runtime).toContain("postReloadState.authorizationRevision !== finalState.authorizationRevision");
    expect(runtime).toContain("canonicalJson(postReloadPermissions) !== canonicalJson(finalPermissions)");
    expect(runtime).toContain("function fixedDetailTimelineDocument(document: UiDocument");
    expect(runtime).toContain('id: "sales-fixed-timeline"');
    expect(runtime).toContain('selectedFields: ["kind", "subject", "status", "occurred-at", "revision", ...(permissions.includes("sales.notes.body.read") ? ["body"] : [])]');
    expect(runtime).toContain("executeWorkspaceSalesAction(payload, context, registeredAction(routeId, nodeId, actionId, selection)");
    expect(runtime).not.toContain("openWorkspacePageSession");
    expect(client).toContain("createUiDocumentRuntime(createUiRuntimeRegistry");
    expect(client).toContain('const query = new URLSearchParams();');
    expect(client).toContain('for (const [key, value] of Object.entries(selection)) query.set(key === "import-job-id" ? "importJobId"');
    expect(client).toContain("export function createSalesRouteRefreshScheduler(run: (signal: AbortSignal) => Promise<void>)");
    expect(client).toContain("if (pending) { queued = true; if (urgent) pendingAbort?.abort(); return; }");
    expect(client).toContain('fetch("/api/k-nex/sales/routes/" + encodeURIComponent(routeId) + "?" + query, { cache: "no-store", signal })');
    expect(client).toContain("if (active && !signal.aborted) { setCurrent(next); if (next !== undefined");
    expect(client).toContain('io({ transports: ["websocket"], withCredentials: true, reconnection: true })');
    expect(client).toContain('socket?.emitWithAck("k-nex:subscribe", { topicId, params: {} })');
    expect(client).toContain('const subscribe = () => { for (const topicId of topics) void socket?.emitWithAck("k-nex:subscribe", { topicId, params: {} }).catch(() => undefined); scheduler.refresh(); };');
    expect(client).toContain('setInterval(() => { scheduler.refresh(); }, 5_000)');
    expect(client).toContain("opaqueRealtimeEvent(event, topics)");
    expect(client).toContain("if (opaqueRealtimeEvent(event, topics)) scheduler.refresh(true);");
    expect(client).toContain('socket?.emitWithAck("k-nex:unsubscribe", { topicId, params: {} })');
    expect(client).toContain("salesAccountDetailDescriptor");
    expect(client).toContain("salesContactDetailDescriptor");
    expect(client).toContain("salesLeadDetailDescriptor");
    expect(client).toContain("salesOpportunityDetailDescriptor");
    expect(client).toContain('data-k-nex-sales-route="unavailable"');
    for (const [routeId, title] of Object.entries({
      "sales.route.overview": "Sales overview", "sales.route.tasks": "Sales tasks", "sales.route.opportunities": "Opportunities", "sales.route.settings": "Sales settings",
      "sales.route.accounts": "Accounts", "sales.route.account-detail": "Account detail", "sales.route.contacts": "Contacts", "sales.route.contact-detail": "Contact detail",
      "sales.route.leads": "Leads", "sales.route.lead-detail": "Lead detail", "sales.route.opportunity-detail": "Opportunity detail"
    })) expect(client).toContain(`${JSON.stringify(routeId)}: ${JSON.stringify(title)}`);
    expect(client).toContain("if (result === undefined || title === undefined)");
    expect(client).toContain("<h1>{title}</h1>");
    expect(client.match(/<h1>/gu)).toHaveLength(1);
    expect(client).toContain("prepareUiRuntimeDocument(candidate.document)");
    expect(client).toContain("DataSourceBindingResultSchema.parse(result)");
    expect(client).toContain('if (!response.ok) throw new Error(body.code ?? "Sales action failed.");');
    expect(client).not.toContain("window.location.reload()");
    expect(client).toContain('fetch("/api/k-nex/sales/actions/" + encodeURIComponent(request.action.id)');
    expect(client).toContain("<SalesTimeline requestState={timeline} permissions={current.permissions} dispatchAction={dispatchAction} />");
    expect(client).toContain("<SalesStateHistory entries={current.stateHistory} />");
    expect(client).toContain("<SalesFixedDetailRouteProvider timeline={timelineElement} history={historyElement} pagination={pagination} hostOwnsRouteChrome>");
    expect(client).toContain("onListPageChange");
    expect(client).toContain("onTimelinePageChange");
    expect(client).toContain('<p role="status" aria-live="polite">Refreshing page…</p>');
    expect(client).toContain('Object.keys(record).sort().join("\\0") !== "actionId\\0fromState\\0occurredAt\\0revision\\0stateField\\0toState"');
    expect(client).toContain(String.raw`!/^sales\.[a-z]+(?:[.-][a-z]+)*$/u.test(record.actionId)`);
    expect(client).toContain("new Date(record.occurredAt).toISOString() !== record.occurredAt");
    expect(client).toContain("const dispatchAction = useCallback(async (request: UiRuntimeActionDispatchRequest)");
    expect(projection).toContain("loadRegisteredSalesRoute(payload, kNexRequestContext(headers, \"sales-route-projection\")");
    expect(projection).toContain("if (id !== null && page !== null || id === null && timelinePage !== null)");
    expect(projection).toContain("query.getAll(key).length !== 1");
    expect(projection).toContain("!/^[1-9][0-9]{0,6}$/u.test(value)");
    expect(projection).toContain("pageNumber(page, 1_000_000)");
    expect(projection).toContain("pageNumber(timelinePage, 4)");
    expect(projection).toContain("routeId, routeParams, pagination, selection), { headers:");
    expect(projection).toContain('status: 404');
    expect(action).toContain("executeRegisteredSalesRouteAction");
    expect(action).toContain('from "../../../../../../k-nex-sales-routes.js"');
    expect(action).toContain('from "../../../../../../k-nex-workspace-page-http.js"');
    expect(action).toContain("request.signal");
    expect(readiness).toContain('"src/app/(workspace)/sales/page.tsx"');
    expect(readiness).toContain('"src/app/(workspace)/sales/accounts/[id]/page.tsx"');
    expect(readiness).toContain('"src/app/(workspace)/sales/contacts/[id]/page.tsx"');
    expect(readiness).toContain('"src/app/(workspace)/sales/leads/[id]/page.tsx"');
    expect(readiness).toContain('"src/app/(workspace)/sales/opportunities/[id]/page.tsx"');
    expect(readiness).toContain('"src/app/api/k-nex/sales/actions/[actionId]/route.ts"');
    expect(readiness).toContain('"src/app/api/k-nex/sales/routes/[routeId]/route.ts"');
  });

  it("keeps the exact current Sales generation available across unrelated lifecycle advances", () => {
    const authority = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-authority.ts"]!;

    expect(authority).toContain("async function currentSalesAuthority(store: PostgresAuthorizationStore)");
    expect(authority).toContain('generation.state === "current" && generation.applicationId === expected.applicationId');
    expect(authority).toContain("canonicalJson(generation.owner) === canonicalJson(kNexSalesRegistry.authorizationGeneration.owner)");
    expect(authority).toContain("kNexSalesRegistry.staticRelease.runtimeGenerationId");
    expect(authority).toContain("generation.lifecycleRevision >= kNexSalesRegistry.authorizationGeneration.lifecycleRevision && generation.lifecycleRevision <= expected.lifecycleRevision");
    expect(authority).not.toContain("generation.lifecycleRevision === expected.lifecycleRevision");
    expect(authority).toContain("if (current === undefined || current.state.lifecycleRevision !== lifecycleRevision) return undefined;");
  });

  it("invalidates Sales dependents when Sales durable availability changes", () => {
    const authority = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-authority.ts"]!;

    expect(authority).toContain("inactive-extension-disabled");
    expect(authority).toContain("inactive-extension-not-ready");
    expect(authority).toContain("entry.owner.generation === generation.owner.generation");
    expect(authority).toContain("lifecycleOverride: Object.freeze({ enabled: !unavailable, ready: !unavailable })");
    expect(authority).toContain("...(snapshot.value === undefined ? {} : { generation: snapshot.value.generation, lifecycleOverride: snapshot.value.lifecycleOverride })");
    expect(authority).toContain("current.generation === undefined || current.lifecycleOverride === undefined ? undefined");
    expect(authority).toContain("extensions: salesContribution === undefined ? [] : [salesContribution]");
    expect(authority).toContain("export async function currentSalesGeneration(payload: Payload)");
    expect(authority).not.toContain("lifecycleRevision !== 0 && lifecycleRevision !== 1");
  });

  it("dispatches durable invalidations through one PostgreSQL channel while shell polling reconciles misses", () => {
    const worker = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-worker.ts"]!;
    const shell = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/app/components/k-nex-workspace-shell.tsx"]!;
    const routeRuntime = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/app/components/k-nex-sales-route-runtime.tsx"]!;

    expect(worker).toContain("PostgresAuthorizationOutboxDispatcher");
    expect(worker).toContain("PostgresWorkspacePageOutboxDispatcher");
    expect(worker).toContain("PostgresWorkspaceNavigationOutboxDispatcher");
    expect(worker.match(/environment: kNexIdentity\.environment/g)).toHaveLength(5);
    expect(worker).toContain('pool.query("select pg_notify($1,$2)"');
    expect(worker).toContain("applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, type, invalidation");
    expect(worker).toContain('notify("authorization", invalidation, signal)');
    expect(worker).toContain("const salesRealtimeOutboxConsumer = Object.freeze");
    expect(worker).toContain('pluginId: "module.sales"');
    expect(worker).toContain('import { salesEventDescriptors } from "@k-nex/module-sales/contracts"');
    expect(worker).toContain("eventTypes: Object.freeze(salesEventDescriptors.map(({ id }) => id))");
    expect(worker).toContain('consumer: salesRealtimeOutboxConsumer');
    expect(worker).toContain('notify("workspace-page", invalidation, signal)');
    expect(worker).toContain('notify("workspace-navigation", invalidation, signal)');
    expect(routeRuntime).toContain('"sales.route.imports": ["sales.realtime.accounts", "sales.realtime.contacts", "sales.realtime.leads", "sales.realtime.import-jobs"]');
    expect(routeRuntime).toContain('"sales.route.exports": ["sales.realtime.accounts", "sales.realtime.contacts", "sales.realtime.leads", "sales.realtime.export-jobs"]');
    expect(shell).toContain("setInterval(async () => {");
    expect(shell).toContain('fetch("/api/k-nex/navigation/revision", { cache: "no-store" })');
  });

  it("hashes full resolved navigation so an already-open sidebar refreshes for page state and metadata", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const navigation = files["src/k-nex-workspace-navigation.ts"]!;
    const shell = files["src/app/components/k-nex-workspace-shell.tsx"]!;
    const route = files["src/app/api/k-nex/navigation/revision/route.ts"]!;

    expect(navigation).toContain('const watermark = "sha256:" + createHash("sha256")');
    expect(navigation).toContain("canonicalJson({\n    navigation,\n    authorizationRevision:");
    expect(navigation).toContain("authorizationRevision: state.authorizationRevision");
    expect(navigation).not.toContain("pages: pageItems.map");
    expect(route).toContain("resolveCurrentWorkspaceNavigation");
    expect(route).toContain('"cache-control": "no-store"');
    expect(shell).toContain('fetch("/api/k-nex/navigation/revision", { cache: "no-store" })');
    expect(route).toContain("navigation: resolved.navigation");
    expect(shell).toContain("setNavigation(body.navigation as ResolvedWorkspaceNavigation)");
    expect(shell).not.toContain("router.refresh()");
  });

  it("uses a server-derived current user and same-origin mutation for durable sidebar state", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const navigation = files["src/k-nex-workspace-navigation.ts"]!;
    const shell = files["src/app/components/k-nex-workspace-shell.tsx"]!;
    const route = files["src/app/api/k-nex/navigation/sidebar/route.ts"]!;

    expect(navigation).toContain("PostgresWorkspaceSidebarPreferenceStore");
    expect(navigation).toContain("const userId = currentUserId(authentication.user);");
    expect(navigation).toContain("sidebarPreferences(payload).read({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, userId })");
    expect(navigation).toContain("updateCurrentWorkspaceSidebarPreference");
    expect(navigation).not.toContain("preferenceKey");
    expect(shell).toContain('fetch("/api/k-nex/navigation/sidebar", { method: "POST", credentials: "same-origin"');
    expect(shell).toContain("JSON.stringify({ sidebar })");
    expect(shell).not.toContain("localStorage");
    expect(route).toContain('openWorkspaceJson(request, "workspace-sidebar-preference")');
    expect(route).toContain('Object.keys(body).join("\\0") !== "sidebar"');
    expect(route).not.toContain("applicationId");
    expect(route).not.toContain("environment");
    expect(route).not.toContain("userId");
  });

  it("consumes validated notifications into one periodically reconciled session registry", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const runtime = files["src/k-nex-workspace-pages.ts"]!;
    const mutations = files["src/app/api/k-nex/workspace-pages/[pageId]/[operation]/route.ts"]!;
    const action = files["src/app/api/k-nex/workspace-pages/[pageId]/actions/[actionId]/route.ts"]!;

    expect(runtime).toContain('notificationClient.query("LISTEN k_nex_runtime_invalidation")');
    expect(runtime).toContain('const workspaceRuntimeRegistryKey = Symbol.for("k-nex.workspace-page-runtime.v1")');
    expect(runtime).toContain("const workspaceRuntimeGlobal = globalThis as unknown as Record<symbol, unknown>");
    expect(runtime).toContain("Object.freeze({ runtimes: new WeakMap(), drainedRuntimes: new WeakSet() })");
    expect(runtime).toContain("const { runtimes, drainedRuntimes } = workspaceRuntimeRegistry");
    expect(runtime).toContain("parseWorkspacePageInvalidation(envelope.invalidation)");
    expect(runtime).toContain("const sessions = new WorkspacePageSessionRegistry()");
    expect(runtime).toContain("const synchronizeTimer = setInterval(synchronizeBackground, 1_000)");
    expect(runtime).toContain("let synchronizing: Promise<void> | undefined");
    expect(runtime).toContain("let closing: Promise<void> | undefined");
    expect(runtime).toContain("let synchronizationQueued = false");
    expect(runtime).toContain("const releasedClients = new WeakSet<object>()");
    expect(runtime).toContain("const operation = Promise.resolve().then(synchronize).then(() => undefined, () => undefined)");
    expect(runtime).toContain("synchronizeBackground();");
    expect(runtime).toContain("await connecting?.catch(() => undefined)");
    expect(runtime).toContain("await synchronizing");
    expect(runtime).toContain("if (closing !== undefined) return closing");
    expect(runtime).toContain('await client.query("UNLISTEN k_nex_runtime_invalidation")');
    const unlisten = runtime.lastIndexOf('await client.query("UNLISTEN k_nex_runtime_invalidation")');
    const release = runtime.indexOf("release(client)", unlisten);
    expect(unlisten).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(unlisten);
    expect(runtime.indexOf("await synchronizing", release)).toBeGreaterThan(release);
    expect(runtime).toContain("export async function drainKnexWorkspacePages(payload: Payload)");
    expect(runtime.indexOf("drainedRuntimes.add(payload)", runtime.indexOf("export async function drainKnexWorkspacePages"))).toBeLessThan(runtime.indexOf("await runtime.close()", runtime.indexOf("export async function drainKnexWorkspacePages")));
    expect(runtime).toContain("const state = await runtime.synchronizeInvalidations()");
    expect(runtime).toContain("runtime.sessions.open({ ...scope, pageId, sessionId");
    expect(mutations).toContain("openWorkspacePageSession(payload, context, pageId");
    expect(mutations).toContain("session.signal");
    expect(action).toContain("executeWorkspaceSalesAction(payload, context, action, value.input, value.idempotencyKey, session.signal)");
  });

  it("shares runtime lifecycle across independently evaluated generated module copies", async () => {
    const directory = mkdtempSync(join(tmpdir(), "k-nex-workspace-runtime-registry-"));
    try {
      const generated = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-workspace-pages.ts"]!;
      const registry = generated.slice(generated.indexOf("type WorkspaceRuntimeRegistry"), generated.indexOf("const invalidationChannel"));
      const listener = generated.slice(generated.indexOf("function listenForInvalidations"), generated.indexOf("function digest"));
      const lifecycle = generated.slice(generated.indexOf("export function kNexWorkspacePages"), generated.indexOf("export async function loadWorkspacePageAccessSubjects"));
      const source = `const invalidationChannel = "k_nex_runtime_invalidation";\nconst validateNotification = () => undefined;\n${registry}\n${listener}\nlet creations = 0;\nfunction createRuntime(payload) { creations += 1; const invalidations = listenForInvalidations(payload, payload.synchronize); return Object.freeze({ instance: creations, close: invalidations.close }); }\n${lifecycle}\nexport function runtimeCreations() { return creations; }\n`;
      const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText;
      writeFileSync(join(directory, "copy-a.mjs"), emitted);
      writeFileSync(join(directory, "copy-b.mjs"), emitted);
      const [copyA, copyB] = await Promise.all([
        import(`${pathToFileURL(join(directory, "copy-a.mjs")).href}?copy-a`),
        import(`${pathToFileURL(join(directory, "copy-b.mjs")).href}?copy-b`)
      ]);
      const entered = Promise.withResolvers<void>();
      const releaseSynchronization = Promise.withResolvers<void>();
      const queries: string[] = [];
      const releases: unknown[] = [];
      let connections = 0;
      const client = {
        async query(text: string) { queries.push(text); },
        on() {},
        release(destroy?: boolean) { releases.push(destroy); }
      };
      const payload = {
        db: { pool: { async connect() { connections += 1; return client; } } },
        async synchronize() { entered.resolve(); await releaseSynchronization.promise; }
      };
      const runtime = copyA.kNexWorkspacePages(payload);
      expect(copyB.kNexWorkspacePages(payload)).toBe(runtime);
      expect(copyA.runtimeCreations()).toBe(1);
      expect(copyB.runtimeCreations()).toBe(0);
      await entered.promise;
      let drained = false;
      const drain = copyB.drainKnexWorkspacePages(payload).then(() => { drained = true; });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(drained).toBe(false);
      expect(connections).toBe(1);
      expect(queries).toEqual(["LISTEN k_nex_runtime_invalidation", "UNLISTEN k_nex_runtime_invalidation"]);
      expect(releases).toEqual([true]);
      expect(() => copyA.kNexWorkspacePages(payload)).toThrow("K-Nex workspace runtime is closed.");
      expect(() => copyB.kNexWorkspacePages(payload)).toThrow("K-Nex workspace runtime is closed.");
      releaseSynchronization.resolve();
      await drain;
      expect(releases).toEqual([true]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("releases the listener before joining one blocked background synchronization", async () => {
    const directory = mkdtempSync(join(tmpdir(), "k-nex-workspace-invalidation-drain-"));
    try {
      const generated = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-workspace-pages.ts"]!;
      const listener = generated.slice(generated.indexOf("function listenForInvalidations"), generated.indexOf("function digest"));
      const source = `const invalidationChannel = "k_nex_runtime_invalidation";\nconst validateNotification = () => undefined;\n${listener}\nexport { listenForInvalidations };\n`;
      writeFileSync(join(directory, "listener.mjs"), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText);
      const { listenForInvalidations } = await import(`${pathToFileURL(join(directory, "listener.mjs")).href}?drain`);
      const entered = Promise.withResolvers<void>();
      const releaseSynchronization = Promise.withResolvers<void>();
      const listeners = new Map<string, (value?: unknown) => void>();
      const queries: string[] = [];
      let checkouts = 0;
      let connections = 0;
      let listenerReleases = 0;
      let synchronizationReleases = 0;
      const listenerClient = {
        async query(text: string) { queries.push(text); },
        on(event: string, callback: (value?: unknown) => void) { listeners.set(event, callback); },
        release() { listenerReleases += 1; checkouts -= 1; }
      };
      const pool = {
        async connect() {
          checkouts += 1;
          connections += 1;
          if (connections === 1) return listenerClient;
          return { release() { synchronizationReleases += 1; checkouts -= 1; } };
        },
        async end() { if (checkouts !== 0) throw new Error("pool retained a checkout"); }
      };
      const runtime = listenForInvalidations({ db: { pool } }, async () => {
        const synchronizationClient = await pool.connect();
        try { entered.resolve(); await releaseSynchronization.promise; }
        finally { synchronizationClient.release(); }
      });
      await entered.promise;
      let drained = false;
      const drain = runtime.close().then(() => { drained = true; });
      let secondDrainFinished = false;
      const secondDrain = runtime.close().then(() => { secondDrainFinished = true; });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(drained).toBe(false);
      expect(secondDrainFinished).toBe(false);
      expect(queries).toEqual(["LISTEN k_nex_runtime_invalidation", "UNLISTEN k_nex_runtime_invalidation"]);
      expect(listenerReleases).toBe(1);
      expect(synchronizationReleases).toBe(0);
      expect(checkouts).toBe(1);
      await expect(pool.end()).rejects.toThrow("pool retained a checkout");
      releaseSynchronization.resolve();
      await Promise.all([drain, secondDrain]);
      await runtime.close();
      await pool.end();
      expect(listenerReleases).toBe(1);
      expect(synchronizationReleases).toBe(1);
      expect(checkouts).toBe(0);

      const trailingEntered = Promise.withResolvers<void>();
      const releaseFirstSynchronization = Promise.withResolvers<void>();
      const trailingListeners = new Map<string, (value?: unknown) => void>();
      let synchronizations = 0;
      let trailingListenerReleases = 0;
      const trailingClient = {
        async query() {},
        on(event: string, callback: (value?: unknown) => void) { trailingListeners.set(event, callback); },
        release() { trailingListenerReleases += 1; }
      };
      const trailingRuntime = listenForInvalidations({ db: { pool: { async connect() { return trailingClient; } } } }, async () => {
        synchronizations += 1;
        if (synchronizations === 1) await releaseFirstSynchronization.promise;
        else trailingEntered.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const notify = () => trailingListeners.get("notification")?.({ channel: "k_nex_runtime_invalidation", payload: "{}" });
      notify();
      notify();
      notify();
      releaseFirstSynchronization.resolve();
      await trailingEntered.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(synchronizations).toBe(2);
      await trailingRuntime.close();
      expect(trailingListenerReleases).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("executes emitted realtime refresh admission with urgent abort, coalescing, and disposal", async () => {
    const client = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/app/components/k-nex-sales-route-runtime.tsx"]!;
    const schedulerSource = client.match(/export function createSalesRouteRefreshScheduler[\s\S]*?\n}\nfunction opaqueRealtimeEvent/);
    const eventSource = client.match(/function opaqueRealtimeEvent[\s\S]*?\n}\n\nfunction stateHistory/);
    expect(schedulerSource).not.toBeNull();
    expect(eventSource).not.toBeNull();
    const source = `${schedulerSource![0].replace(/\nfunction opaqueRealtimeEvent$/, "").replace("export function", "function")}\n${eventSource![0].replace(/\n\nfunction stateHistory$/, "")}`;
    const executable = ts.transpileModule(`${source}\nreturn { createSalesRouteRefreshScheduler, opaqueRealtimeEvent };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const emitted = new Function("AbortController", executable)(AbortController) as Readonly<{ createSalesRouteRefreshScheduler: (run: (signal: AbortSignal) => Promise<void>) => Readonly<{ refresh(urgent?: boolean): void; dispose(): void }>; opaqueRealtimeEvent: (value: unknown, allowed: ReadonlySet<string>) => boolean }>;
    const create = emitted.createSalesRouteRefreshScheduler;
    const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
    const first = Promise.withResolvers<string>(); const second = Promise.withResolvers<string>(); const signals: AbortSignal[] = []; const published: string[] = [];
    const scheduler = create(async (signal) => { signals.push(signal); const value = await (signals.length === 1 ? first.promise : second.promise); if (!signal.aborted) published.push(value); });
    scheduler.refresh(); await flush();
    const topics = new Set(["sales.realtime.opportunities"]);
    const event = Object.freeze({ correlationId: "realtime-correlation", topicId: "sales.realtime.opportunities", messageClass: "reconstructible-invalidation", event: Object.freeze({ correlation: "event-correlation", dedupe: "event-dedupe", event: "sales.event.opportunity-changed", source: "module.sales", topic: "sales.realtime.opportunities" }) });
    expect(emitted.opaqueRealtimeEvent(event, topics)).toBe(true);
    if (emitted.opaqueRealtimeEvent(event, topics)) scheduler.refresh(true);
    if (emitted.opaqueRealtimeEvent(event, topics)) scheduler.refresh(true);
    if (emitted.opaqueRealtimeEvent(event, topics)) scheduler.refresh(true);
    expect(signals).toHaveLength(1); expect(signals[0]!.aborted).toBe(true);
    first.resolve("stale"); await flush(); expect(signals).toHaveLength(2); expect(signals[1]!.aborted).toBe(false);
    second.resolve("fresh"); await flush(); expect(published).toEqual(["fresh"]);
    const held = Promise.withResolvers<void>(); const closingSignals: AbortSignal[] = [];
    const closing = create(async (signal) => { closingSignals.push(signal); await held.promise; });
    closing.refresh(); await flush(); closing.dispose(); closing.refresh(true);
    expect(closingSignals).toHaveLength(1); expect(closingSignals[0]!.aborted).toBe(true);
    held.resolve(); await flush(); expect(closingSignals).toHaveLength(1);
  });
});
