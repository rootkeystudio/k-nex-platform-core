import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

const applicationId = "p13-crm-browser";
const environment = "test";

async function cookie(origin, persona) {
  const response = await fetch(`${origin}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: persona.email, password: persona.password })
  });
  assert.equal(response.status, 200, await response.text());
  const value = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(value, "login did not issue a session cookie");
  return value;
}

async function until(check, detail) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(detail());
}

async function enqueueOwnerReport(origin, ownerCookie) {
  const response = await fetch(`${origin}/api/k-nex/sales/actions/sales.report.run`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie, origin, referer: `${origin}/sales/reports` },
    body: JSON.stringify({
      routeId: "sales.route.reports",
      nodeId: "weighted-forecast",
      input: { reportId: "sales.report.weighted-forecast", windowMode: "as-of" },
      selection: {},
      idempotencyKey: "p13-9-restore-report-run"
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data?.state, "queued", JSON.stringify(body));
  assert.equal(typeof body.data?.reportRunId, "string", JSON.stringify(body));
  return body.data.reportRunId;
}

async function reportEvidence(pool, runId) {
  const result = await pool.query(`
    select r.run_id,r.artifact_id,r.artifact_digest,r.execution_metadata,r.execution_metadata_digest,r.source_watermark,
      a.bytes,a.digest artifact_digest_from_artifact,a.metadata,a.metadata_digest,
      d.artifact_digest delivery_artifact_digest,d.metadata delivery_metadata,d.metadata_digest delivery_metadata_digest,d.digest delivery_digest
    from sales_report_runs r
    join sales_report_artifacts a on a.run_id=r.run_id
    join sales_report_delivery_receipts d on d.run_id=r.run_id
    where r.run_id=$1 and r.application_id=$2 and r.environment=$3 and r.state='succeeded'
  `, [runId, applicationId, environment]);
  assert.equal(result.rows.length, 1, `missing succeeded report evidence for ${runId}`);
  const row = result.rows[0];
  assert.equal(row.artifact_digest, row.artifact_digest_from_artifact, "run and artifact digests diverged");
  assert.equal(row.execution_metadata_digest, row.metadata_digest, "run and artifact execution digests diverged");
  assert.equal(row.execution_metadata_digest, row.delivery_metadata_digest, "run and delivery execution digests diverged");
  assert.equal(row.artifact_digest, row.delivery_artifact_digest, "run and delivery artifact digests diverged");
  assert.equal(row.execution_metadata?.executionDigest, row.execution_metadata_digest, "run metadata has no canonical execution digest");
  assert.equal(row.metadata?.executionDigest, row.metadata_digest, "artifact metadata has no canonical execution digest");
  assert.equal(row.delivery_metadata?.executionDigest, row.delivery_metadata_digest, "delivery metadata has no canonical execution digest");
  assert.match(row.source_watermark, /^sha256:[0-9a-f]{64}$/u);
  return Object.freeze({
    runId: row.run_id,
    artifactId: row.artifact_id,
    bytes: Buffer.from(row.bytes),
    artifactDigest: row.artifact_digest,
    executionMetadata: row.execution_metadata,
    executionDigest: row.execution_metadata_digest,
    sourceWatermark: row.source_watermark,
    artifactMetadata: row.metadata,
    deliveryMetadata: row.delivery_metadata,
    deliveryDigest: row.delivery_digest
  });
}

async function downloadReport(origin, sessionCookie, artifactId) {
  const response = await fetch(`${origin}/api/k-nex/sales/report-artifact?artifactId=${encodeURIComponent(artifactId)}`, { headers: { cookie: sessionCookie } });
  return Object.freeze({ status: response.status, contentType: response.headers.get("content-type"), bytes: Buffer.from(await response.arrayBuffer()) });
}

async function login(browser, origin, persona) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const response = await page.goto(`${origin}/login`);
  assert.equal(response?.status(), 200);
  await page.getByLabel("Email").fill(persona.email);
  await page.getByLabel("Password").fill(persona.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
  return { context, page };
}

async function visit(page, origin, path, heading) {
  const response = await page.goto(`${origin}${path}`);
  assert.equal(response?.status(), 200, `${path} returned ${response?.status()}`);
  await page.locator("#workspace-main").waitFor();
  await page.getByRole("heading", { name: heading, exact: true }).waitFor();
}

async function databaseSnapshot(pool) {
  const result = await pool.query(`
    select
      (select count(*)::int from sales_accounts where application_id=$1 and environment=$2) as accounts,
      (select count(*)::int from sales_contacts where application_id=$1 and environment=$2) as contacts,
      (select count(*)::int from sales_leads where application_id=$1 and environment=$2) as leads,
      (select count(*)::int from sales_pipelines where application_id=$1 and environment=$2) as pipelines,
      (select count(*)::int from sales_pipeline_stages where application_id=$1 and environment=$2) as stages,
      (select count(*)::int from sales_saved_views where application_id=$1 and environment=$2) as saved_views,
      (select count(*)::int from sales_opportunities where application_id=$1 and environment=$2) as opportunities,
      (select count(*)::int from sales_activities where application_id=$1 and environment=$2) as activities,
      (select count(*)::int from sales_notes where application_id=$1 and environment=$2) as notes,
      (select count(*)::int from sales_attachment_references where application_id=$1 and environment=$2) as attachments,
      (select count(*)::int from k_nex_outbox) as outbox,
      (select count(*)::int from sales_action_idempotency where application_id=$1 and environment=$2) as idempotency,
      (select count(*)::int from sales_crm_migration_receipts where application_id=$1 and environment=$2) as migration_receipts,
      (
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_accounts where application_id=$1 and environment=$2) +
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_contacts where application_id=$1 and environment=$2) +
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_leads where application_id=$1 and environment=$2) +
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_pipelines where application_id=$1 and environment=$2) +
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_pipeline_stages where application_id=$1 and environment=$2) +
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_saved_views where application_id=$1 and environment=$2) +
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_opportunities where application_id=$1 and environment=$2) +
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_activities where application_id=$1 and environment=$2) +
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_notes where application_id=$1 and environment=$2) +
        (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_attachment_references where application_id=$1 and environment=$2)
      )::int as audit_entries
  `, [applicationId, environment]);
  return Object.freeze({ ...result.rows[0] });
}

async function assertHealthAndInventory(page) {
  const result = await page.evaluate(async () => {
    const [healthResponse, inventoryResponse] = await Promise.all([fetch("/api/health", { cache: "no-store" }), fetch("/api/k-nex/inventory", { cache: "no-store" })]);
    return { health: { status: healthResponse.status, body: await healthResponse.text() }, inventory: { status: inventoryResponse.status, body: await inventoryResponse.text() } };
  });
  assert.equal(result.health.status, 200, result.health.body);
  assert.equal(result.inventory.status, 200, result.inventory.body);
  const inventory = JSON.parse(result.inventory.body);
  assert.deepEqual(inventory.plugins, ["module.sales"]);
}

async function assertAuditEvidence(pool, records) {
  const result = await pool.query(`
    select
      (select audit->0->>'actionId' from sales_accounts where id=$1 and application_id=$5 and environment=$6) as account_action,
      (select audit->0->>'kind' from sales_pipelines where id=$2 and application_id=$5 and environment=$6) as pipeline_kind,
      (select audit->0->>'actionId' from sales_activities where id=$3 and application_id=$5 and environment=$6) as activity_action,
      (select audit->0->>'actionId' from sales_notes where body=$4 and application_id=$5 and environment=$6 limit 1) as note_action
  `, [records.accountId, records.pipelineId, records.activityId, records.noteBody, applicationId, environment]);
  assert.deepEqual(result.rows[0], {
    account_action: "sales.account.create",
    pipeline_kind: "phase-13-pipeline-stage-identity",
    activity_action: "sales.activity.create",
    note_action: "sales.note.create"
  });
}

async function assertCurrentPermissionBoundary(browser, origin, records, personas) {
  const owner = await login(browser, origin, personas.owner);
  try {
    await visit(owner.page, origin, `/sales/accounts/${records.accountId}`, "Account detail");
    await owner.page.getByText("Browser account", { exact: true }).waitFor();
    assert.equal(await owner.page.getByRole("button", { name: "Account Update", exact: true }).count(), 1, "authorized owner lost Account Update visibility");
  } finally {
    await owner.context.close();
  }

  const viewer = await login(browser, origin, personas.viewer);
  try {
    await visit(viewer.page, origin, `/sales/accounts/${records.accountId}`, "Account detail");
    await viewer.page.getByText("Browser account", { exact: true }).waitFor();
    for (const label of ["Account Update", "Account Archive", "Ownership Assign", "Activity Create", "Note Create", "Attachment Link"]) {
      assert.equal(await viewer.page.getByRole("button", { name: label, exact: true }).count(), 0, `viewer received ${label}`);
    }
    assert.equal(await viewer.page.locator("[data-action-id]").count(), 0, "viewer received a timeline mutation control");
    const denied = await viewer.page.evaluate(async ({ accountId, pageOrigin }) => {
      const response = await fetch("/api/k-nex/sales/actions/sales.account.update", {
        method: "POST",
        headers: { "content-type": "application/json", origin: pageOrigin },
        body: JSON.stringify({
          routeId: "sales.route.account-detail",
          nodeId: "sales-page-account-detail-main",
          input: { id: accountId, expectedRevision: 1, name: "P13.9 denied update" },
          selection: {},
          idempotencyKey: "p13-9-restore-denied-update"
        })
      });
      return { status: response.status, body: await response.text() };
    }, { accountId: records.accountId, pageOrigin: origin });
    assert.equal(denied.status, 403, denied.body);
  } finally {
    await viewer.context.close();
  }
}

test("P13.9 generated Chromium proves physical Postgres restore preserves current CRM product", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, stopWorker, stopWeb, startWorker, startWeb, restoreToCleanDatabase, workerOutput }) => {
    const browser = await chromium.launch({ headless: true });
    let activePool = pool;
    try {
      const sourceDatabase = (await activePool.query("select current_database() as name")).rows[0].name;
      const ownerCookie = await cookie(origin, personas.owner);
      const reportRunId = await enqueueOwnerReport(origin, ownerCookie);
      await until(
        async () => (await activePool.query("select state from sales_report_runs where run_id=$1", [reportRunId])).rows[0]?.state === "succeeded",
        () => `P13.9 owner report did not complete before backup: ${workerOutput()}`
      );
      const preservedReport = await reportEvidence(activePool, reportRunId);
      const sourceDownload = await downloadReport(origin, ownerCookie, preservedReport.artifactId);
      assert.equal(sourceDownload.status, 200, `owner could not download report before backup: ${sourceDownload.bytes.toString("utf8")}`);
      assert.match(sourceDownload.contentType ?? "", /^text\/csv(?:;|$)/u);
      assert.deepEqual(sourceDownload.bytes, preservedReport.bytes, "pre-backup report endpoint bytes diverged from artifact evidence");
      const before = await databaseSnapshot(activePool);

      await stopWorker();
      await stopWeb();
      activePool = await restoreToCleanDatabase();

      const restoredDatabase = (await activePool.query("select current_database() as name")).rows[0].name;
      assert.notEqual(restoredDatabase, sourceDatabase, "restore must use a distinct database");
      assert.match(restoredDatabase, /^p13_crm_browser_restore_[a-z0-9]+$/u);
      assert.deepEqual(await databaseSnapshot(activePool), before, "physical restore changed durable record/effect counts");
      await assertAuditEvidence(activePool, records);

      await startWeb();
      await startWorker();
      const restoredOwnerCookie = await cookie(origin, personas.owner);
      const restoredReport = await reportEvidence(activePool, reportRunId);
      assert.equal(restoredReport.artifactId, preservedReport.artifactId, "restore changed report artifact identity");
      assert.equal(restoredReport.artifactDigest, preservedReport.artifactDigest, "restore changed report artifact digest");
      assert.equal(restoredReport.executionDigest, preservedReport.executionDigest, "restore changed canonical execution digest");
      assert.equal(restoredReport.sourceWatermark, preservedReport.sourceWatermark, "restore changed captured source watermark");
      assert.deepEqual(restoredReport.executionMetadata, preservedReport.executionMetadata, "restore changed execution metadata");
      assert.deepEqual(restoredReport.artifactMetadata, preservedReport.artifactMetadata, "restore changed artifact metadata");
      assert.deepEqual(restoredReport.deliveryMetadata, preservedReport.deliveryMetadata, "restore changed delivery metadata");
      assert.equal(restoredReport.deliveryDigest, preservedReport.deliveryDigest, "restore changed delivery receipt digest");
      assert.deepEqual(restoredReport.bytes, preservedReport.bytes, "restore changed report artifact bytes");
      const restoredDownload = await downloadReport(origin, restoredOwnerCookie, preservedReport.artifactId);
      assert.equal(restoredDownload.status, 200, `owner could not download restored report: ${restoredDownload.bytes.toString("utf8")}`);
      assert.match(restoredDownload.contentType ?? "", /^text\/csv(?:;|$)/u);
      assert.deepEqual(restoredDownload.bytes, preservedReport.bytes, "restored report endpoint changed artifact bytes");
      const restoredViewerCookie = await cookie(origin, personas.viewer);
      const deniedReport = await downloadReport(origin, restoredViewerCookie, preservedReport.artifactId);
      assert.equal(deniedReport.status, 403, "unrelated viewer downloaded restored owner report");
      assert.notEqual(deniedReport.contentType, "text/csv", "denied viewer response exposed CSV");
      assert.notDeepEqual(deniedReport.bytes, preservedReport.bytes, "denied viewer response exposed report bytes");
      const owner = await login(browser, origin, personas.owner);
      try {
        await assertHealthAndInventory(owner.page);
        await visit(owner.page, origin, "/sales", "Sales overview");

        await visit(owner.page, origin, "/sales/opportunities", "Opportunities");
        await owner.page.getByRole("button", { name: "Kanban", exact: true }).click();
        await owner.page.waitForURL((url) => url.searchParams.get("mode") === "kanban");
        await owner.page.locator('[data-k-nex-component="sales-opportunity-kanban"]').waitFor();
        assert.equal(await owner.page.locator('[data-slot="kanban-columns"] > section').count(), 6, "restored pipeline lost stage columns");

        await visit(owner.page, origin, `/sales/accounts/${records.accountId}`, "Account detail");
        for (const label of ["Ownership", "Timeline", "Tasks and reminders", "State history", "Authorized actions"]) await owner.page.getByRole("region", { name: label }).waitFor();
        await owner.page.getByText("activity:call: Complete browser activity", { exact: true }).waitFor();
        try { await owner.page.getByText(records.noteBody).waitFor(); }
        catch (error) { throw new Error(`${error}\nurl=${owner.page.url()}\nbody=${await owner.page.locator("body").innerText()}`); }
        await assertCurrentPermissionBoundary(browser, origin, records, personas);
      } finally {
        await owner.context.close();
      }

      const restoredCounts = await databaseSnapshot(activePool);
      assert.deepEqual(restoredCounts, before, "browser reads or denied action changed restored record/effect counts");

      await stopWorker();
      await stopWeb();
      await startWeb();
      await startWorker();
      const restartedOwner = await login(browser, origin, personas.owner);
      try {
        await assertHealthAndInventory(restartedOwner.page);
        await visit(restartedOwner.page, origin, "/sales", "Sales overview");
        await visit(restartedOwner.page, origin, `/sales/accounts/${records.accountId}`, "Account detail");
        await restartedOwner.page.getByText(records.noteBody).waitFor();
      } finally {
        await restartedOwner.context.close();
      }
      assert.deepEqual(await databaseSnapshot(activePool), before, "web restart changed restored record/effect counts");
      await assertAuditEvidence(activePool, records);
    } finally {
      await browser.close();
    }
  });
});
