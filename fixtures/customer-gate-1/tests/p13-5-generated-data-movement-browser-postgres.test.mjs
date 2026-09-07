import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import test from "node:test";

import { chromium } from "playwright";

import { seriousAccessibilityViolations } from "./p13-3-browser-accessibility.mjs";
import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function login(browser, origin, persona) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(20_000);
  const response = await page.goto(`${origin}/login`); assert.equal(response?.status(), 200);
  await page.getByLabel("Email").fill(persona.email); await page.getByLabel("Password").fill(persona.password);
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
  return { context, page };
}

async function visit(page, path, heading, diagnostics = () => "") {
  const response = await page.goto(new URL(path, page.url()).toString());
  assert.equal(response?.status(), 200, `${path} returned ${response?.status()}\n${diagnostics()}`);
  await page.locator("#workspace-main").waitFor(); await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  assert.deepEqual(await seriousAccessibilityViolations(page), [], `serious/critical accessibility violations at ${path}`);
}

async function submit(page, actionId, buttonName, diagnostics = () => "") {
  const button = page.getByRole("button", { name: buttonName, exact: true }); await button.waitFor();
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/k-nex/sales/actions/${actionId}`),
    button.click()
  ]);
  const body = await response.json(); assert.equal(response.status(), 200, `${actionId} returned ${response.status()}: ${JSON.stringify(body)}\n${diagnostics()}`);
  assert.equal(body.action?.id, actionId); return body.data;
}

async function authorizationRevision(pool) {
  const row = (await pool.query("select authorization_revision from k_nex_authorization_state limit 1")).rows[0];
  assert.ok(Number.isSafeInteger(row?.authorization_revision)); return Number(row.authorization_revision);
}

function formFor(page, buttonName) { return page.getByRole("button", { name: buttonName, exact: true }).locator("xpath=ancestor::form"); }

async function chunkedOversizedImport(origin, cookie) {
  const url = new URL("/api/k-nex/sales/import-upload", origin);
  assert.equal(url.protocol, "http:");
  return await new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: "POST", headers: { cookie, origin, "content-type": "application/json" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    request.on("error", reject);
    request.write('{"artifactId":"p135-oversized-stream","bytesBase64":"');
    for (let index = 0; index < 23; index += 1) request.write("A".repeat(1_000_000));
    request.end('","contentType":"text/csv"}');
  });
}

async function eventually(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let failure;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value !== undefined) return value; }
    catch (error) { failure = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw failure ?? new Error(message);
}

test("P13.5 generated Chromium completes accessible imports, request-local merge, and export download journeys", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, applicationOutput, startWorker, stopWorker }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const owner = await login(browser, origin, personas.manager);
      try {
        const revision = await authorizationRevision(pool);
        await stopWorker();
        const viewer = await login(browser, origin, personas.viewer);
        try {
          const actionBody = { routeId: "sales.route.imports", nodeId: "import-list", selection: {}, idempotencyKey: "p135-manager-authority-probe", input: { request: { uploadArtifactId: "missing-authority-probe", targetObjectType: "sales.object.lead", columnMapping: [{ header: "Display name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }], expectedAuthorizationRevision: revision } } };
          const call = async (page, path, body, key) => await page.evaluate(async ({ path, body, key }) => {
            const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...(key === undefined ? {} : { "idempotency-key": key }) }, body: JSON.stringify(body) });
            return { status: response.status, body: await response.json() };
          }, { path, body, key });
          const projection = async (page) => await page.evaluate(async () => {
            const response = await fetch("/api/k-nex/sales/routes/sales.route.imports?page=1");
            return { status: response.status, body: await response.json() };
          });
          const managerImportSource = await projection(owner.page);
          assert.equal(managerImportSource.status, 200, `Manager's registered import source must resolve through generated route: ${JSON.stringify(managerImportSource.body)}`);
          assert.equal((await projection(viewer.page)).status, 404, "Custom viewer role must not resolve generated import source.");
          assert.equal((await call(owner.page, "/api/k-nex/sales/actions/sales.import.dry-run", actionBody)).status, 400, "Manager must pass generated action authority before missing upload validation.");
          assert.equal((await call(viewer.page, "/api/k-nex/sales/actions/sales.import.dry-run", { ...actionBody, idempotencyKey: "p135-viewer-authority-probe" })).status, 403, "Custom viewer role must not execute generated import action.");
        } finally { await viewer.context.close(); }
        await visit(owner.page, "/sales/imports", "Imports", applicationOutput);
        for (const label of ["Upload artifact ID", "Target object type", "Column mapping JSON", "Authorization revision", "Validate CSV import", "Queue import", "Cancel import", "Confirm merge"]) await owner.page.getByLabel(label, { exact: true }).or(owner.page.getByRole("button", { name: label, exact: true })).first().waitFor();

        const cookie = (await owner.context.cookies(origin)).map(({ name, value }) => `${name}=${value}`).join("; ");
        const oversizedUpload = await chunkedOversizedImport(origin, cookie);
        assert.deepEqual(oversizedUpload, { status: 400, body: { code: "IMPORT_LIMIT_EXCEEDED" } }, "Chunked oversized uploads must fail before CSV allocation.");

        const bomContent = Buffer.from("Display name,Source\\r\\nP13.5 BOM lead,web\\r\\n");
        const bomUpload = await owner.page.evaluate(async ({ bytesBase64 }) => {
          const response = await fetch("/api/k-nex/sales/import-upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ artifactId: "p135-bom-import", bytesBase64, contentType: "text/csv" }) });
          return { status: response.status, body: await response.json() };
        }, { bytesBase64: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bomContent]).toString("base64") });
        assert.deepEqual(bomUpload, { status: 201, body: { uploadArtifactId: "p135-bom-import", sha256: `sha256:${createHash("sha256").update(bomContent).digest("hex")}`, byteLength: bomContent.byteLength, contentType: "text/csv" } }, "BOM must be excluded from the durable upload digest and byte count.");
        assert.deepEqual((await pool.query("select digest,byte_length,octet_length(bytes)::int as stored_length from sales_import_uploads where artifact_id='p135-bom-import'")).rows, [{ digest: bomUpload.body.sha256, byte_length: bomContent.byteLength, stored_length: bomContent.byteLength }]);

        const upload = await owner.page.evaluate(async () => {
          const bytesBase64 = btoa("Display name,Source\r\nP13.5 imported lead,web\r\n");
          const response = await fetch("/api/k-nex/sales/import-upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ artifactId: "p135-browser-import", bytesBase64, contentType: "text/csv" }) });
          return { status: response.status, body: await response.json() };
        });
        assert.equal(upload.status, 201, JSON.stringify(upload.body));
        const dryRun = formFor(owner.page, "Validate CSV import");
        await dryRun.getByLabel("Upload artifact ID", { exact: true }).fill("p135-browser-import");
        await dryRun.getByLabel("Authorization revision", { exact: true }).fill(String(revision));
        const validated = await submit(owner.page, "sales.import.dry-run", "Validate CSV import", applicationOutput);
        assert.equal(validated.state, "validated");
        await owner.page.waitForURL((url) => url.searchParams.get("importJobId") === String(validated.importJobId));
        const importProjection = await owner.page.evaluate(async ({ importJobId, expectedRevision }) => {
          const response = await fetch(`/api/k-nex/sales/routes/sales.route.imports?page=1&importJobId=${importJobId}&expected-revision=${expectedRevision}`);
          return { status: response.status, body: await response.json() };
        }, { importJobId: validated.importJobId, expectedRevision: validated.revision });
        assert.equal(importProjection.status, 200, `Import projection failed: ${JSON.stringify(importProjection.body)}\n${applicationOutput()}`);

        const queue = formFor(owner.page, "Queue import"); await queue.getByLabel("Authorization revision", { exact: true }).fill(String(revision));
        const queued = await submit(owner.page, "sales.import.commit", "Queue import");
        assert.equal(queued.state, "queued");
        assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.import-job-changed' and payload->>'jobId'=$1 and payload->>'state'='queued'", [String(queued.importJobId)])).rows[0].count), 0, "Queue admission must not publish a synthetic queued job event.");
        await owner.page.waitForURL((url) => url.searchParams.get("expected-revision") === String(queued.revision));
        await visit(owner.page, `/sales/imports?importJobId=${queued.importJobId}&expected-revision=${queued.revision}`, "Imports", applicationOutput);
        const cancelled = await submit(owner.page, "sales.import.cancel", "Cancel import"); assert.equal(cancelled.state, "cancelled");

        const subject = (await pool.query("select id,revision,owner_id,team_id from sales_accounts where id=$1", [records.managerAccountId])).rows[0];
        const duplicate = (await pool.query("insert into sales_accounts(application_id,environment,owner_id,team_id,created_by,updated_by,name,audit) values ('p13-crm-browser','test',$1,$2,$1,$1,'Manager account','[]'::jsonb) returning id,revision", [subject.owner_id, subject.team_id])).rows[0];
        await visit(owner.page, `/sales/imports?targetObjectType=sales.object.account&recordId=${records.managerAccountId}&expected-revision=${subject.revision}`, "Imports", applicationOutput);
        await owner.page.getByText(`Winner: ${records.managerAccountId}; selected candidate becomes the merged record.`, { exact: true }).waitFor();
        const candidate = owner.page.getByRole("button", { name: `Select candidate ${duplicate.id}`, exact: true }); await candidate.focus(); assert.equal(await candidate.evaluate((element) => element === document.activeElement), true);
        await candidate.click();
        const merge = formFor(owner.page, "Confirm merge"); await merge.getByLabel("Type MERGE to confirm", { exact: true }).fill("MERGE"); await merge.getByLabel("Authorization revision", { exact: true }).fill(String(revision));
        const merged = await submit(owner.page, "sales.merge.commit", "Confirm merge");
        assert.equal(merged.winnerId, Number(records.managerAccountId)); assert.equal(merged.loserId, Number(duplicate.id));
        await owner.page.goto(`${origin}/sales/accounts/${duplicate.id}`);
        await owner.page.waitForURL((url) => url.pathname === `/sales/accounts/${records.managerAccountId}`);

        await visit(owner.page, "/sales/exports", "Exports");
        const create = formFor(owner.page, "Create export"); await create.getByLabel("Authorization revision", { exact: true }).fill(String(revision));
        const exported = await submit(owner.page, "sales.export.create", "Create export"); assert.equal(exported.state, "queued");
        assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.export-job-changed' and payload->>'jobId'=$1 and payload->>'state'='queued'", [String(exported.exportJobId)])).rows[0].count), 0, "Export admission must not publish a synthetic queued job event.");
        await owner.page.waitForURL((url) => url.searchParams.get("exportJobId") === String(exported.exportJobId));
        await visit(owner.page, `/sales/exports?exportJobId=${exported.exportJobId}&expected-revision=${exported.revision}`, "Exports", applicationOutput);
        const exportCancelled = await submit(owner.page, "sales.export.cancel", "Cancel export"); assert.equal(exportCancelled.state, "cancelled");

        await formFor(owner.page, "Create export").getByLabel("Authorization revision", { exact: true }).fill(String(revision));
        const completedExport = await submit(owner.page, "sales.export.create", "Create export"); assert.equal(completedExport.state, "queued");
        await owner.page.waitForURL((url) => url.searchParams.get("exportJobId") === String(completedExport.exportJobId));
        // Simulate promotion before the old generated worker observes this queued job.
        // It must self-fence: no claim, artifact, or terminal mutation under generation 2.
        await pool.query("update runtime_static_deployments set revision=2,active_generation_id='sales-generation-2',active_generation='{\"generationId\":\"sales-generation-2\"}'::jsonb,state_digest=$3 where application_id=$1 and environment=$2", ["p13-crm-browser", "test", "sha256:2d4da657afb6d1554c1645a54428126ab1f809c573dbe2e91d6172174739925b"]);
        await pool.query("update runtime_worker_generation_fences set active_execution_generation='sales-generation-2',fencing_token=2,lease_owner='fixture:p13-crm-browser:worker-2',promotion_revision=2,lease_expires_at=now()+interval '10 minutes' where application_id=$1 and environment=$2", ["p13-crm-browser", "test"]);
        await startWorker();
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.deepEqual((await pool.query("select state,revision,artifact_id from sales_export_jobs where id=$1", [completedExport.exportJobId])).rows, [{ state: "queued", revision: 1, artifact_id: null }], "A promoted-out generated worker must not claim, mutate, or complete data movement.");
        await stopWorker();
        await startWorker("sales-generation-2");
        const completed = await eventually(async () => {
          const row = (await pool.query("select revision,state,artifact_id from sales_export_jobs where id=$1", [completedExport.exportJobId])).rows[0];
          return row?.state === "succeeded" && typeof row.artifact_id === "string" ? row : undefined;
        }, "Generated worker did not complete the export.");
        assert.equal(completed.state, "succeeded"); assert.equal(typeof completed.artifact_id, "string");
        await visit(owner.page, `/sales/exports?exportJobId=${completedExport.exportJobId}&expected-revision=${completed.revision}`, "Exports", applicationOutput);
        const artifactResponse = await owner.page.evaluate(async (artifactId) => { const response = await fetch(`/api/k-nex/sales/export-artifact?artifactId=${encodeURIComponent(artifactId)}`); return { status: response.status, disposition: response.headers.get("content-disposition"), body: await response.text() }; }, completed.artifact_id);
        assert.equal(artifactResponse.status, 200, `${JSON.stringify(artifactResponse)}\n${applicationOutput()}`); assert.match(artifactResponse.disposition ?? "", /attachment/u); assert.match(artifactResponse.body, /display-name,status/u);
        const downloadButton = owner.page.getByRole("button", { name: "Download export", exact: true }); const [download] = await Promise.all([owner.page.waitForEvent("download"), downloadButton.click()]);
        assert.equal(await download.failure(), null); assert.match(download.suggestedFilename(), /\.csv$/u);
      } finally { await owner.context.close(); }
    } finally { await browser.close(); }
  });
});
