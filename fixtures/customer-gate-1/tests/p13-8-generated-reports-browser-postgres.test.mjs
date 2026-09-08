import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { chromium } from "playwright";
import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

const app = "p13-crm-browser"; const environment = "test";

async function cookie(origin, persona) {
  const response = await fetch(`${origin}/api/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: persona.email, password: persona.password }) });
  assert.equal(response.status, 200, await response.text());
  const value = response.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(value); return value;
}
async function until(check, detail) {
  for (let attempt = 0; attempt < 80; attempt += 1) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(detail());
}

test("P13.8 generated HTTP/Chromium reports route queues one artifact and keeps unrelated CRM healthy", { timeout: 420000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ application, origin, personas, records, pool, stopWorker, startWorker, workerOutput, applicationOutput }) => {
    const ownerCookie = await cookie(origin, personas.owner);
    const reportCookie = await cookie(origin, personas.manager);
    const viewerCookie = await cookie(origin, personas.viewer);
    const ownerId = String((await pool.query("select id from users where email=$1", [personas.owner.email])).rows[0]?.id);
    assert.notEqual(ownerId, "undefined");
    await pool.query(
      "insert into sales_activities(application_id,environment,owner_id,team_id,created_by,updated_by,status,type,subject,actor_id,scheduled_at,occurred_at,related_record_id,related_record_type) select $1,$2,$3,$4,$3,$3,'completed','call','P13.8 report pagination ' || n,'p13.8-page-actor-' || n,now(),now(),$5,'sales.account' from generate_series(1,26) n",
      [app, environment, ownerId, `team:${ownerId}`, records.accountId]
    );
    const pageSource = resolve(application, "src/app/(workspace)/sales/reports/page.tsx");
    const routeDirectory = resolve(application, ".next/server/app/(workspace)/sales/reports");
    const appPathsManifest = resolve(application, ".next/server/app-paths-manifest.json");
    const sourceExists = existsSync(pageSource);
    const routeExists = existsSync(routeDirectory);
    const routeEntries = routeExists ? readdirSync(routeDirectory).sort() : [];
    const manifestHasRoute = existsSync(appPathsManifest) && readFileSync(appPathsManifest, "utf8").includes("/sales/reports/page");
    const [ownerDirect, managerDirect, viewerDirect] = await Promise.all([
      fetch(`${origin}/api/k-nex/sales/routes/sales.route.reports`, { headers: { cookie: ownerCookie } }),
      fetch(`${origin}/api/k-nex/sales/routes/sales.route.reports`, { headers: { cookie: reportCookie } }),
      fetch(`${origin}/api/k-nex/sales/routes/sales.route.reports`, { headers: { cookie: viewerCookie } })
    ]);
    const [ownerBody, managerBody, viewerBody] = await Promise.all([ownerDirect.text(), managerDirect.text(), viewerDirect.text()]);
    assert.equal(ownerDirect.status, 200, `owner reports projection=${ownerDirect.status} body=${ownerBody} source=${sourceExists} build-route=${routeExists} entries=${JSON.stringify(routeEntries)} app-paths-route=${manifestHasRoute} server=${applicationOutput()}`);
    assert.equal(managerDirect.status, 200, `manager reports projection=${managerDirect.status} body=${managerBody} source=${sourceExists} build-route=${routeExists} entries=${JSON.stringify(routeEntries)} app-paths-route=${manifestHasRoute} server=${applicationOutput()}`);
    assert.equal(viewerDirect.status, 200, `viewer may read reports route but never gain export authority: ${viewerBody}`);
    const viewerId = String((await pool.query("select id from users where email=$1", [personas.viewer.email])).rows[0]?.id); assert.notEqual(viewerId, "undefined");
    assert.equal(Object.keys(JSON.parse(ownerBody).sourceResults ?? {}).length, 7, "owner projection has exact closed report catalog");
    assert.equal(Object.keys(JSON.parse(managerBody).sourceResults ?? {}).length, 7, "manager projection has exact closed report catalog");
    const tablePage = async (nodeId, page) => {
      const response = await fetch(`${origin}/api/k-nex/sales/routes/sales.route.reports?page=${page}`, { headers: { cookie: viewerCookie } });
      const body = await response.json(); assert.equal(response.status, 200, `${nodeId} page ${page}: ${JSON.stringify(body)}`); return body.sourceResults?.[nodeId];
    };
    for (const nodeId of ["activity-by-owner-team", "task-aging"]) {
      const first = await tablePage(nodeId, 1); const second = await tablePage(nodeId, 2);
      const firstRows = first?.data?.rows ?? []; const secondRows = second?.data?.rows ?? [];
      assert.equal(first?.state, "success", `${nodeId} first page is admitted through the registered reports route: ${JSON.stringify(first)}`);
      assert.equal(second?.state, "success", `${nodeId} second page is admitted through the registered reports route: ${JSON.stringify(second)}`);
      assert.equal(first?.data?.page?.number, 1, `${nodeId} records the requested first page`);
      assert.equal(second?.data?.page?.number, 2, `${nodeId} records the requested second page`);
      assert.equal(first?.data?.page?.pageSize, second?.data?.page?.pageSize, `${nodeId} retains its fixed bounded page size`);
      assert.equal(new Set([...firstRows, ...secondRows].map((row) => row.key)).size, firstRows.length + secondRows.length, `${nodeId} pages have globally stable non-overlapping keys`);
      if (nodeId === "activity-by-owner-team") {
        assert.equal(firstRows.length, 25, "activity report fills its bounded first page");
        assert.equal(first?.data?.page?.hasNext, true, "activity report advertises its real second page");
        assert.ok(secondRows.length > 0, "activity report returns its real second page");
      } else {
        assert.equal(firstRows.length, 5, "task aging returns its closed five-bucket catalog");
        assert.equal(first?.data?.page?.hasNext, false, "task aging cannot exceed its five-bucket bound");
        assert.equal(secondRows.length, 0, "task aging offset beyond its closed catalog is empty");
      }
    }
    const viewerSources = JSON.stringify(JSON.parse(viewerBody).sourceResults ?? {});
    assert.match(viewerSources, /SOURCE_FORBIDDEN/u, "Viewer without sales.opportunities.amount.read receives report-source denials in the authenticated reports projection");
    assert.equal(viewerSources.includes("98765.43"), false, "the reports projection contains no denied pipeline/forecast amount bytes");
    const viewerRun = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.run`, {
      method: "POST", headers: { "content-type": "application/json", cookie: viewerCookie, origin, referer: `${origin}/sales/reports` },
      body: JSON.stringify({ routeId: "sales.route.reports", nodeId: "weighted-forecast", input: { reportId: "sales.report.weighted-forecast", windowMode: "as-of" }, selection: {}, idempotencyKey: "p138-viewer-export-denied" })
    });
    assert.equal(viewerRun.status, 403, `Viewer lacks sales.exports.execute: ${await viewerRun.text()}`);
    assert.equal(Number((await pool.query("select count(*) count from sales_report_runs where idempotency_key='p138-viewer-export-denied'")).rows[0].count), 0, "denied viewer export queues no durable run");
    const viewerSchedule = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.schedule`, {
      method: "POST", headers: { "content-type": "application/json", cookie: viewerCookie, origin, referer: `${origin}/sales/reports` },
      body: JSON.stringify({ routeId: "sales.route.reports", nodeId: "sales-cycle-duration", input: { operation: "upsert", reportId: "sales.report.sales-cycle-duration", recipientId: viewerId, expectedRevision: 0, weekday: 1, localTime: "09:00", windowMode: "current-reporting-week" }, selection: {}, idempotencyKey: "p138-viewer-schedule-denied" })
    });
    assert.equal(viewerSchedule.status, 403, `Viewer lacks sales.reports.schedule: ${await viewerSchedule.text()}`);
    assert.equal(Number((await pool.query("select count(*) count from sales_report_schedules where creator_id=(select id::text from users where email=$1)", [personas.viewer.email])).rows[0].count), 0, "denied viewer schedule creates no durable state");

    // This must be a persisted Phase 12 custom document, not the fixed Sales
    // reports route: page ACL may admit its shell but cannot widen report data
    // or the separately granted export action.
    const postForm = async (path, fields) => {
      const response = await fetch(`${origin}${path}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: ownerCookie, origin }, body: new URLSearchParams(fields) });
      assert.equal(response.status, 303, `${path}: ${await response.text()}`); return response;
    };
    const customRole = "p13-reports-custom-page-viewer";
    await postForm("/api/system/access/roles", { id: customRole, label: "P13 reports custom page viewer" });
    await postForm(`/api/system/access/roles/${encodeURIComponent(customRole)}/permissions`, { permissionId: "system.workspace-pages.read" });
    await postForm("/api/system/access/assignments", { roleId: customRole, userId: viewerId });
    // The viewer's canonical role has report read plus underlying source grants,
    // but no export or schedule grant. Add only schedule through a separate
    // assigned role: scheduling must not become manual export authority.
    await postForm(`/api/system/access/roles/${encodeURIComponent(customRole)}/permissions`, { permissionId: "sales.reports.schedule" });
    const mutableScheduleScope = (await pool.query(
      "update sales_current_authority_scopes set record_scope='application-sales-scope',application_wide=true,mutation_allowed=true,revision=revision+1 where application_id=$1 and environment=$2 and principal_id=$3 and mutation_allowed=false returning record_scope,application_wide,mutation_allowed,revision",
      [app, environment, viewerId]
    )).rows;
    assert.deepEqual(mutableScheduleScope, [{ record_scope: "application-sales-scope", application_wide: true, mutation_allowed: true, revision: 2 }], "schedule-only actor has a mutable application scope without gaining export authority");
    const scheduleOnlyBody = { routeId: "sales.route.reports", nodeId: "sales-cycle-duration", input: { operation: "upsert", reportId: "sales.report.sales-cycle-duration", recipientId: viewerId, expectedRevision: 0, weekday: 1, localTime: "09:00", windowMode: "current-reporting-week" }, selection: {}, idempotencyKey: "p138-viewer-schedule-only" };
    const scheduleOnly = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.schedule`, {
      method: "POST", headers: { "content-type": "application/json", cookie: viewerCookie, origin, referer: `${origin}/sales/reports` }, body: JSON.stringify(scheduleOnlyBody)
    });
    const scheduleOnlyResult = await scheduleOnly.json();
    assert.equal(scheduleOnly.status, 200, JSON.stringify(scheduleOnlyResult));
    assert.deepEqual(scheduleOnlyResult.data, { reportId: "sales.report.sales-cycle-duration", recipientId: viewerId, state: "active", revision: 1 }, "schedule-only actor may schedule a no-amount report");
    const scheduleOnlyManual = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.run`, {
      method: "POST", headers: { "content-type": "application/json", cookie: viewerCookie, origin, referer: `${origin}/sales/reports` },
      body: JSON.stringify({ routeId: "sales.route.reports", nodeId: "weighted-forecast", input: { reportId: "sales.report.weighted-forecast", windowMode: "as-of" }, selection: {}, idempotencyKey: "p138-viewer-schedule-only-export-denied" })
    });
    assert.equal(scheduleOnlyManual.status, 403, `schedule-only actor must not gain sales.exports.execute: ${await scheduleOnlyManual.text()}`);
    const scheduleOnlyRow = (await pool.query("select schedule_id from sales_report_schedules where application_id=$1 and environment=$2 and creator_id=$3 and report_id='sales.report.sales-cycle-duration'", [app, environment, viewerId])).rows[0];
    assert.equal(typeof scheduleOnlyRow?.schedule_id, "string");
    await pool.query("update sales_report_schedules set next_run_at=now()-interval '1 second' where schedule_id=$1", [scheduleOnlyRow.schedule_id]);
    await until(async () => (await pool.query("select state from sales_report_runs where scheduled_for is not null and recipient_id=$1 and report_id='sales.report.sales-cycle-duration' order by requested_at desc limit 1", [viewerId])).rows[0]?.state === "succeeded", () => workerOutput());
    const scheduleOnlyArtifact = (await pool.query("select artifact_id from sales_report_runs where scheduled_for is not null and recipient_id=$1 and report_id='sales.report.sales-cycle-duration' order by requested_at desc limit 1", [viewerId])).rows[0]?.artifact_id;
    assert.equal(typeof scheduleOnlyArtifact, "string");
    const scheduleOnlyDownload = await fetch(`${origin}/api/k-nex/sales/report-artifact?artifactId=${encodeURIComponent(scheduleOnlyArtifact)}`, { headers: { cookie: viewerCookie } });
    assert.equal(scheduleOnlyDownload.status, 200, `scheduled artifact remains downloadable without sales.exports.execute: ${await scheduleOnlyDownload.text()}`);
    const customCreate = await fetch(`${origin}/api/k-nex/workspace-pages`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: ownerCookie, origin },
      body: new URLSearchParams({ title: "P13.8 report ACL proof", description: "page ACL cannot widen report authority", parentNavigationId: "sales.navigation.root", order: "9138", themeRevision: "", idempotencyKey: "p138-custom-report-page-create" })
    });
    assert.equal(customCreate.status, 303, await customCreate.text());
    const customPageId = decodeURIComponent(new URL(customCreate.headers.get("location"), origin).pathname.split("/").at(-1));
    assert.match(customPageId, /^workspace\.page\./u);
    const customEditor = await fetch(`${origin}/api/k-nex/workspace-pages/${encodeURIComponent(customPageId)}/session?mode=edit`, { headers: { cookie: ownerCookie } });
    assert.equal(customEditor.status, 200);
    const customEditorBody = await customEditor.json(); const customWorkingCopy = customEditorBody.projection?.workingCopy;
    assert.ok(customWorkingCopy && Number.isSafeInteger(customWorkingCopy.revision) && customWorkingCopy.document && typeof customWorkingCopy.document === "object");
    const salesContracts = await import(pathToFileURL(resolve(process.cwd(), "modules/sales/dist/contracts.js")).href);
    const reportNodeId = "p138-custom-weighted-forecast";
    const reportNode = {
      id: reportNodeId, type: "sales.block.report.weighted-forecast", version: 1, props: {},
      bindings: {
        source: { source: { id: salesContracts.salesWeightedForecastDescriptor.id, version: salesContracts.salesWeightedForecastDescriptor.version }, input: {}, structuralCompatibilityHash: salesContracts.salesWeightedForecastDescriptor.structuralCompatibilityHash, selectedFields: [] }
      }
    };
    const customDocument = { ...customWorkingCopy.document, version: customWorkingCopy.revision + 1, regions: { ...customWorkingCopy.document.regions, main: [reportNode] } };
    const customSave = await fetch(`${origin}/api/k-nex/workspace-pages/${encodeURIComponent(customPageId)}/autosave`, {
      method: "POST", headers: { "content-type": "application/json", cookie: ownerCookie, origin },
      body: JSON.stringify({ expectedRevision: customWorkingCopy.revision, editorSessionId: "p138-custom-report-editor", idempotencyKey: "p138-custom-report-save", document: customDocument })
    });
    const customSaveBody = await customSave.text();
    assert.equal(customSave.status, 200, customSaveBody);
    const customSaved = JSON.parse(customSaveBody);
    const customPublish = await fetch(`${origin}/api/k-nex/workspace-pages/${encodeURIComponent(customPageId)}/publish`, {
      method: "POST", headers: { "content-type": "application/json", cookie: ownerCookie, origin }, body: JSON.stringify({ workingCopyRevision: customSaved.workingCopy.revision, idempotencyKey: "p138-custom-report-publish" })
    });
    assert.equal(customPublish.status, 200, await customPublish.text());
    const customAccessEditor = await fetch(`${origin}/api/k-nex/workspace-pages/${encodeURIComponent(customPageId)}/session?mode=edit`, { headers: { cookie: ownerCookie } });
    assert.equal(customAccessEditor.status, 200);
    const customWatermark = (await customAccessEditor.json()).projection.watermark;
    const customAccess = new URLSearchParams({ expectedPageRevision: String(customWatermark.pageRevision), expectedAccessRevision: String(customWatermark.accessRevision), idempotencyKey: "p138-custom-report-access" });
    customAccess.append("assignment", `user|${viewerId}|view`);
    const customAcl = await fetch(`${origin}/api/k-nex/workspace-pages/${encodeURIComponent(customPageId)}/access`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: ownerCookie, origin }, body: customAccess });
    assert.equal(customAcl.status, 303, await customAcl.text());
    const customSession = await fetch(`${origin}/api/k-nex/workspace-pages/${encodeURIComponent(customPageId)}/session`, { headers: { cookie: viewerCookie } });
    assert.equal(customSession.status, 200);
    assert.equal(customSession.headers.get("cache-control"), "no-store", "personalized custom report projection is never shared-cacheable");
    const customProjection = (await customSession.json()).projection;
    assert.equal(customProjection.permissions.includes("sales.exports.execute"), false, "page ACL cannot add the export grant to its action catalog");
    assert.match(JSON.stringify(customProjection.sourceResults?.[reportNodeId]), /SOURCE_FORBIDDEN/u, "page ACL cannot add the denied amount field to report-source authority");
    const customHtml = await fetch(`${origin}/workspace/pages/${encodeURIComponent(customPageId)}`, { headers: { cookie: viewerCookie } });
    const customHtmlText = await customHtml.text();
    assert.equal(customHtml.status, 200, customHtmlText);
    assert.equal(customHtmlText.includes("98765.43"), false, "custom page HTML contains no denied report amount");
    assert.match(customHtmlText, /SOURCE_FORBIDDEN|Unavailable/u, "custom page renders the source denial, not report bytes");
    const customRun = await fetch(`${origin}/api/k-nex/workspace-pages/${encodeURIComponent(customPageId)}/actions/sales.report.run`, {
      method: "POST", headers: { "content-type": "application/json", cookie: viewerCookie, origin, referer: `${origin}/workspace/pages/${encodeURIComponent(customPageId)}` },
      body: JSON.stringify({ nodeId: reportNodeId, input: { reportId: "sales.report.weighted-forecast", windowMode: "as-of" }, idempotencyKey: "p138-custom-page-viewer-export-denied" })
    });
    assert.equal(customRun.status, 404, `a custom report block has no export action binding for page ACL to widen: ${await customRun.text()}`);
    assert.equal(Number((await pool.query("select count(*) count from sales_report_runs where idempotency_key='p138-custom-page-viewer-export-denied'")).rows[0].count), 0, "unbound custom-page export creates no run");
    assert.equal(sourceExists, true, `reports page source missing: ${pageSource}`);
    assert.equal(routeExists, true, `reports page build output missing: ${routeDirectory}; parent=${readdirSync(resolve(application, ".next/server/app/(workspace)/sales"))}`);
    assert.equal(manifestHasRoute, true, `reports page route absent from ${appPathsManifest}`);
    const browser = await chromium.launch({ headless: true });
    try {
      const viewerContext = await browser.newContext(); const viewerPage = await viewerContext.newPage();
      await viewerPage.goto(`${origin}/login`); await viewerPage.getByLabel("Email").fill(personas.viewer.email); await viewerPage.getByLabel("Password").fill(personas.viewer.password); await viewerPage.getByRole("button", { name: "Sign in" }).click(); await viewerPage.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
      const viewerPageResponse = await viewerPage.goto(`${origin}/sales/reports`);
      assert.equal(viewerPageResponse?.status(), 200);
      assert.equal((await viewerPage.locator("body").innerText()).includes("Export report"), false, "viewer reports UI cannot render a manual export affordance");
      await viewerContext.close();
      const context = await browser.newContext(); const page = await context.newPage();
      await page.goto(`${origin}/login`); await page.getByLabel("Email").fill(personas.manager.email); await page.getByLabel("Password").fill(personas.manager.password); await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
      const reportPage = await page.goto(`${origin}/sales/reports`);
      assert.equal(reportPage?.status(), 200, `reports page status=${reportPage?.status()} body=${await page.locator("body").innerText()} server=${applicationOutput()}`);
      await page.locator("#workspace-main").waitFor({ timeout: 30_000 }).catch(async (error) => { throw new Error(`reports shell absent: ${await page.locator("body").innerText()} url=${page.url()} server=${applicationOutput()} cause=${error instanceof Error ? error.message : String(error)}`); });
      const projection = await page.evaluate(async () => { const response = await fetch("/api/k-nex/sales/routes/sales.route.reports"); return { status: response.status, value: await response.json() }; });
      assert.equal(projection.status, 200, JSON.stringify(projection.value));
      assert.equal(Object.keys(projection.value.sourceResults ?? {}).length, 7, "fixed route projects exactly seven registered reports");
      await stopWorker();
      const body = { routeId: "sales.route.reports", nodeId: "weighted-forecast", input: { reportId: "sales.report.weighted-forecast", windowMode: "as-of" }, selection: {}, idempotencyKey: "p138-browser-report-run" };
      const acceptedResponse = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.run`, { method: "POST", headers: { "content-type": "application/json", cookie: reportCookie, origin, referer: `${origin}/sales/reports` }, body: JSON.stringify(body) });
      const accepted = await acceptedResponse.json(); assert.equal(acceptedResponse.status, 200, JSON.stringify(accepted));
      const replay = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.run`, { method: "POST", headers: { "content-type": "application/json", cookie: reportCookie, origin, referer: `${origin}/sales/reports` }, body: JSON.stringify(body) });
      assert.deepEqual(await replay.json(), accepted, "manual report action replay stays idempotent");
      const runId = accepted.data?.reportRunId; assert.equal(typeof runId, "string");
      await startWorker();
      await until(async () => (await pool.query("select state from sales_report_runs where run_id=$1", [runId])).rows[0]?.state === "succeeded", () => workerOutput());
      await stopWorker();
      const scheduleBody = { routeId: "sales.route.reports", nodeId: "sales-cycle-duration", input: { operation: "upsert", reportId: "sales.report.sales-cycle-duration", recipientId: personas.manager.id, expectedRevision: 0, weekday: 1, localTime: "09:00", windowMode: "current-reporting-week" }, selection: {}, idempotencyKey: "p138-browser-report-schedule" };
      const managerId = String((await pool.query("select id from users where email=$1", [personas.manager.email])).rows[0]?.id);
      assert.notEqual(managerId, "undefined");
      scheduleBody.input.recipientId = managerId;
      const scheduledResponse = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.schedule`, { method: "POST", headers: { "content-type": "application/json", cookie: reportCookie, origin, referer: `${origin}/sales/reports` }, body: JSON.stringify(scheduleBody) });
      const scheduled = await scheduledResponse.json(); assert.equal(scheduledResponse.status, 200, JSON.stringify(scheduled));
      assert.deepEqual(scheduled.data, { reportId: "sales.report.sales-cycle-duration", recipientId: managerId, state: "active", revision: 1 });
      const scheduleReplay = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.schedule`, { method: "POST", headers: { "content-type": "application/json", cookie: reportCookie, origin, referer: `${origin}/sales/reports` }, body: JSON.stringify(scheduleBody) });
      const scheduleReplayBody = await scheduleReplay.json();
      assert.equal(scheduleReplay.status, 200, JSON.stringify(scheduleReplayBody));
      assert.deepEqual(scheduleReplayBody, scheduled, "weekly schedule replay remains idempotent");
      const staleSchedule = { ...scheduleBody, input: { ...scheduleBody.input, expectedRevision: 0 }, idempotencyKey: "p138-browser-report-schedule-stale" };
      const staleScheduleResponse = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.schedule`, { method: "POST", headers: { "content-type": "application/json", cookie: reportCookie, origin, referer: `${origin}/sales/reports` }, body: JSON.stringify(staleSchedule) });
      assert.equal(staleScheduleResponse.status, 409, await staleScheduleResponse.text(), "schedule CAS rejects a stale second create");
      const scheduleRow = (await pool.query("select schedule_id,revision,state from sales_report_schedules where application_id='p13-crm-browser' and environment='test' and creator_id=$1 and report_id='sales.report.sales-cycle-duration'", [managerId])).rows[0];
      assert.deepEqual({ revision: scheduleRow?.revision, state: scheduleRow?.state }, { revision: 1, state: "active" });
      await pool.query("update sales_report_schedules set next_run_at=now()-interval '1 second' where schedule_id=$1", [scheduleRow.schedule_id]);
      await startWorker();
      await until(async () => (await pool.query("select state from sales_report_runs where scheduled_for is not null and report_id='sales.report.sales-cycle-duration' and recipient_id=$1 order by requested_at desc limit 1", [managerId])).rows[0]?.state === "succeeded", () => workerOutput());
      await stopWorker();
      const advancedSchedule = (await pool.query("select revision,state,next_run_at>now() advanced from sales_report_schedules where schedule_id=$1", [scheduleRow.schedule_id])).rows[0];
      assert.deepEqual(advancedSchedule, { revision: 2, state: "active", advanced: true }, "due schedule creates once then advances by one weekly CAS revision");
      const cancelBody = { routeId: "sales.route.reports", nodeId: "sales-cycle-duration", input: { operation: "cancel", reportId: "sales.report.sales-cycle-duration", recipientId: managerId, expectedRevision: 2 }, selection: {}, idempotencyKey: "p138-browser-report-schedule-cancel" };
      const cancelledResponse = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.schedule`, { method: "POST", headers: { "content-type": "application/json", cookie: reportCookie, origin, referer: `${origin}/sales/reports` }, body: JSON.stringify(cancelBody) });
      const cancelled = await cancelledResponse.json(); assert.equal(cancelledResponse.status, 200, JSON.stringify(cancelled));
      assert.deepEqual(cancelled.data, { reportId: "sales.report.sales-cycle-duration", recipientId: managerId, state: "cancelled", revision: 3 });
      const reactivateBody = { ...scheduleBody, input: { ...scheduleBody.input, expectedRevision: 3 }, idempotencyKey: "p138-browser-report-schedule-reactivate" };
      const [reactivateOne, reactivateTwo] = await Promise.all([
        fetch(`${origin}/api/k-nex/sales/actions/sales.report.schedule`, { method: "POST", headers: { "content-type": "application/json", cookie: reportCookie, origin, referer: `${origin}/sales/reports` }, body: JSON.stringify(reactivateBody) }),
        fetch(`${origin}/api/k-nex/sales/actions/sales.report.schedule`, { method: "POST", headers: { "content-type": "application/json", cookie: reportCookie, origin, referer: `${origin}/sales/reports` }, body: JSON.stringify({ ...reactivateBody, idempotencyKey: "p138-browser-report-schedule-reactivate-race" }) })
      ]);
      const reactivations = await Promise.all([reactivateOne, reactivateTwo].map(async (response) => ({ status: response.status, body: await response.json() })));
      assert.deepEqual(reactivations.map(({ status }) => status).sort((left, right) => left - right), [200, 409], `concurrent reactivation admits exactly one current revision: ${JSON.stringify(reactivations)}`);
      assert.deepEqual(reactivations.find(({ status }) => status === 200)?.body.data, { reportId: "sales.report.sales-cycle-duration", recipientId: managerId, state: "active", revision: 4 }, "a cancelled schedule reactivates in-place rather than creating an eighth schedule identity");
      assert.deepEqual((await pool.query("select count(*) count, max(revision) revision, bool_and(state='active') active from sales_report_schedules where application_id='p13-crm-browser' and environment='test' and creator_id=$1 and report_id='sales.report.sales-cycle-duration'", [managerId])).rows[0], { count: "1", revision: 4, active: true }, "CAS race preserves one canonical schedule row");
      assert.equal(Number((await pool.query("select count(*) count from sales_report_schedule_audit where schedule_id=$1", [scheduleRow.schedule_id])).rows[0].count), 4, "schedule upsert, due advance, cancel, and reactivation each audit atomically");
      const artifact = (await pool.query("select artifact_id from sales_report_runs where run_id=$1", [runId])).rows[0]?.artifact_id; assert.equal(typeof artifact, "string");
      const download = await fetch(`${origin}/api/k-nex/sales/report-artifact?artifactId=${encodeURIComponent(artifact)}`, { headers: { cookie: reportCookie } });
      assert.equal(download.status, 200); assert.match(await download.text(), /\r\n$/u);
      const account = await fetch(`${origin}/api/k-nex/sales/actions/sales.account.create`, { method: "POST", headers: { "content-type": "application/json", cookie: ownerCookie, origin, referer: `${origin}/sales/accounts` }, body: JSON.stringify({ routeId: "sales.route.accounts", nodeId: "sales-page-accounts-main", input: { name: "P13.8 peer health" }, selection: {}, idempotencyKey: "p138-peer-account" }) });
      assert.equal(account.status, 200, "report job cannot poison unrelated account action");
      await pool.query("update sales_current_authority_scopes set revision=revision+1,record_scope='explicit-application-or-team-scope',application_wide=false,mutation_allowed=false,authorized_team_ids='[]'::jsonb where application_id=$1 and environment=$2 and principal_id=$3", [app, environment, managerId]);
      const narrowedDownload = await fetch(`${origin}/api/k-nex/sales/report-artifact?artifactId=${encodeURIComponent(artifact)}`, { headers: { cookie: reportCookie } });
      assert.equal(narrowedDownload.status, 403, `narrowed report scope cannot download a broader artifact: ${await narrowedDownload.text()}`);
      assert.notEqual(narrowedDownload.headers.get("content-type"), "text/csv", "narrowed scope response contains no artifact bytes");
      await pool.query("update sales_current_authority_scopes set revision=revision+1,record_scope='managed-teams-and-own',application_wide=false,mutation_allowed=true,authorized_team_ids=$4::jsonb where application_id=$1 and environment=$2 and principal_id=$3", [app, environment, managerId, JSON.stringify([`team:${managerId}`])]);
      await pool.query("update k_nex_extension_authorization_generations set state='retired' where application_id=$1 and delivery_class='platform-plugin' and extension_id='module.sales' and state='current'", [app]);
      const retiredDownload = await fetch(`${origin}/api/k-nex/sales/report-artifact?artifactId=${encodeURIComponent(artifact)}`, { headers: { cookie: reportCookie } });
      assert.equal(retiredDownload.status, 403, `retired Sales generation cannot serve prior artifact bytes: ${await retiredDownload.text()}`);
      assert.notEqual(retiredDownload.headers.get("content-type"), "text/csv", "retired generation response contains no artifact bytes");
    } finally { await browser.close(); }
  });
});
