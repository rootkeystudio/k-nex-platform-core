import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { seriousAccessibilityViolations } from "./p13-3-browser-accessibility.mjs";
import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function bounded(promise, label, timeoutMs = 25_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

async function eventually(check, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let failure;
  while (Date.now() < deadline) {
    try { if (await check()) return; }
    catch (error) { failure = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw failure ?? new Error(message);
}

async function responseText(response, label) {
  return bounded(response.text(), `${label} body`, 20_000);
}

function expectedHeading(path) {
  const segments = new URL(path, "http://browser.invalid").pathname.split("/").filter(Boolean);
  const kind = segments[1];
  const headings = {
    accounts: { list: "Accounts", detail: "Account detail" },
    contacts: { list: "Contacts", detail: "Contact detail" },
    leads: { list: "Leads", detail: "Lead detail" },
    opportunities: { list: "Opportunities", detail: "Opportunity detail" }
  };
  const selected = headings[kind];
  assert.ok(selected, `No expected heading for ${path}.`);
  return segments.length === 2 ? selected.list : selected.detail;
}

async function login(browser, origin, persona) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const response = await bounded(page.goto(`${origin}/login`), "login route");
  assert.equal(response?.status(), 200, `Login route returned ${response?.status()}.`);
  await page.getByLabel("Email").fill(persona.email);
  await page.getByLabel("Password").fill(persona.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
  return { context, page };
}

async function accessible(page, path) {
  const response = await bounded(page.goto(new URL(path, page.url()).toString()), `${path} navigation`);
  assert.equal(response?.status(), 200, `${path} returned ${response?.status()}.`);
  await page.locator("#workspace-main").waitFor();
  await page.getByRole("heading", { name: expectedHeading(path), exact: true }).waitFor();
  assert.deepEqual(await seriousAccessibilityViolations(page), [], `serious/critical accessibility violations at ${path}`);
}

async function routeProjection(page, routeId, id, query = "") {
  const result = await bounded(page.evaluate(async ({ routeId: selectedRoute, recordId, query: suffix }) => {
    const signal = AbortSignal.timeout(20_000);
    const response = await fetch(`/api/k-nex/sales/routes/${selectedRoute}?id=${encodeURIComponent(recordId)}${suffix}`, { cache: "no-store", signal });
    return { status: response.status, body: await response.text() };
  }, { routeId, recordId: id, query }), `${routeId} projection`);
  let body;
  try { body = JSON.parse(result.body); }
  catch { throw new Error(`${routeId} returned non-JSON: ${result.body}`); }
  return { status: result.status, body };
}

function projectionRecord(projection, id) {
  for (const result of Object.values(projection.sourceResults ?? {})) {
    const rows = result?.data?.rows;
    if (!Array.isArray(rows)) continue;
    const record = rows.find((row) => row?.key === id);
    if (record !== undefined) return record;
  }
  return undefined;
}

function timelineProjectionRecord(projection, id) {
  const rows = projection.timeline?.data?.rows;
  return Array.isArray(rows) ? rows.find((row) => row?.key === id) : undefined;
}

function cellValue(cell) {
  return cell !== null && typeof cell === "object" && "value" in cell ? cell.value : cell;
}

async function exactDetailProjection(page, routeId, id, expected = {}) {
  const projection = await routeProjection(page, routeId, id);
  assert.equal(projection.status, 200, JSON.stringify(projection.body));
  const record = projectionRecord(projection.body, id);
  assert.ok(record, `${routeId} omitted ${id}: ${JSON.stringify(projection.body)}`);
  for (const [field, value] of Object.entries(expected)) {
    const actual = cellValue(record.values[field]);
    assert.deepEqual(typeof value === "string" && typeof actual === "number" ? String(actual) : actual, value, `${routeId} ${field}`);
  }
  return { projection: projection.body, record };
}

function currentDetail(page) {
  const segments = new URL(page.url()).pathname.split("/").filter(Boolean);
  if (segments.length !== 3 || segments[0] !== "sales") return undefined;
  const routes = { accounts: "account", contacts: "contact", leads: "lead", opportunities: "opportunity" };
  const kind = routes[segments[1]];
  return kind === undefined ? undefined : { id: segments[2], routeId: `sales.route.${kind}-detail` };
}

async function submitAction(page, actionId, fields = {}, options = {}) {
  process.stdout.write(`P13_3_CRM_BROWSER_STAGE action-${actionId}-start\n`);
  const label = actionId.split(".").slice(1).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
  const button = page.getByRole("button", { name: label, exact: true });
  try { await button.waitFor(); }
  catch (error) {
    const detail = currentDetail(page);
    const projection = detail === undefined ? undefined : await routeProjection(page, detail.routeId, detail.id);
    throw new Error(`${error}\nurl=${page.url()}\nbody=${await page.locator("body").innerText()}\nprojection=${JSON.stringify(projection)}`);
  }
  const form = button.locator("xpath=ancestor::form");
  const revision = form.getByLabel("Expected revision", { exact: true });
  const priorRevision = await revision.count() === 0 ? undefined : await revision.inputValue();
  const configuredModes = new Set();
  if (actionId === "sales.lead.qualify") {
    for (const [modeLabel, dependentLabel] of [["Account mode", "Account ID"], ["Contact mode", "Contact ID"]]) {
      const mode = fields[modeLabel];
      if (mode === undefined) continue;
      const modeControl = form.getByLabel(modeLabel, { exact: true });
      await modeControl.selectOption(String(mode));
      assert.equal(await modeControl.inputValue(), String(mode), `${modeLabel} did not settle before dependent qualification fields`);
      configuredModes.add(modeLabel);
      if (mode === "link") {
        const dependent = form.getByLabel(dependentLabel, { exact: true });
        await dependent.waitFor();
        if (fields[dependentLabel] !== undefined) {
          await dependent.fill(String(fields[dependentLabel]));
          configuredModes.add(dependentLabel);
        }
      }
    }
  }
  for (const [label, value] of Object.entries(fields)) {
    if (configuredModes.has(label)) continue;
    const control = form.getByLabel(label, { exact: true });
    if (await control.evaluate((element) => element instanceof HTMLSelectElement)) await control.selectOption(String(value));
    else await control.fill(String(value));
  }
  await button.focus();
  assert.equal(await button.evaluate((element) => element === document.activeElement), true, `${actionId} must receive keyboard focus`);
  const [response] = await bounded(Promise.all([
    page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/k-nex/sales/actions/${actionId}`),
    page.keyboard.press("Enter")
  ]), `${actionId} response`);
  const responseBody = await bounded(response.text(), `${actionId} response body`);
  assert.equal(response.status(), 200, `${actionId} returned ${response.status()}: ${responseBody}`);
  let payload;
  try { payload = JSON.parse(responseBody); }
  catch { throw new Error(`${actionId} returned non-JSON: ${responseBody}`); }
  assert.deepEqual(Object.keys(payload.action ?? {}).sort(), ["id", "version"]);
  assert.equal(payload.action.id, actionId);
  assert.equal(Number.isSafeInteger(payload.action.version), true);
  assert.equal(typeof payload.data?.id, "string", `${actionId} returned no canonical ID.`);
  assert.equal(Number.isSafeInteger(payload.data?.revision), true, `${actionId} returned no revision.`);
  if (options.expectConfirmation !== false && options.terminal !== true) {
    try { await form.getByRole("status").filter({ hasText: `${label} completed.` }).waitFor(); }
    catch (error) { throw new Error(`${error}\n${actionId} response=${responseBody}\nstatuses=${JSON.stringify(await page.getByRole("status").allInnerTexts())}`); }
  }
  if (priorRevision !== undefined) {
    assert.ok(payload.data.revision > Number(priorRevision), `${actionId} revision did not advance.`);
  }
  if (priorRevision !== undefined && options.expectProjection !== false) {
    const detail = currentDetail(page);
    assert.ok(detail, `${actionId} mutation occurred outside a fixed detail route.`);
    await eventually(async () => cellValue((await exactDetailProjection(page, detail.routeId, detail.id)).record.values.revision) === payload.data.revision, `${actionId} projection did not reach revision ${payload.data.revision}.`);
    if (options.terminal === true) await eventually(async () => await button.count() === 0, `${actionId} terminal action remained reachable.`);
    else await eventually(async () => await revision.inputValue() === String(payload.data.revision), `${actionId} form did not refresh its exact CAS revision.`);
  }
  process.stdout.write(`P13_3_CRM_BROWSER_STAGE action-${actionId}-complete\n`);
  return payload.data;
}

async function submitDeniedAction(page, actionId, fields = {}) {
  process.stdout.write(`P13_3_CRM_BROWSER_STAGE denied-${actionId}-start\n`);
  const label = actionId.split(".").slice(1).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
  const button = page.getByRole("button", { name: label, exact: true });
  const form = button.locator("xpath=ancestor::form");
  for (const [fieldLabel, value] of Object.entries(fields)) {
    const control = form.getByLabel(fieldLabel, { exact: true });
    if (await control.evaluate((element) => element instanceof HTMLSelectElement)) await control.selectOption(String(value));
    else await control.fill(String(value));
  }
  const [response] = await bounded(Promise.all([
    page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/k-nex/sales/actions/${actionId}`),
    button.focus().then(() => page.keyboard.press("Enter"))
  ]), `${actionId} denied response`);
  const body = await responseText(response, `${actionId} denied response`);
  assert.equal(response.status(), 403, `${actionId} permission denial returned ${response.status()}: ${body}`);
  await form.getByRole("status").filter({ hasText: `${label} failed.` }).waitFor();
  process.stdout.write(`P13_3_CRM_BROWSER_STAGE denied-${actionId}-complete\n`);
  return JSON.parse(body);
}

async function keyboardDetail(page, path, rowName) {
  const row = page.getByRole("row").filter({ hasText: rowName });
  const view = row.getByRole("button", { name: "View", exact: true });
  await view.focus();
  assert.equal(await view.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press("Enter");
  const link = page.locator(`a[href="${path}"]`).first();
  try { await link.waitFor(); }
  catch (error) {
    const projection = await bounded(page.evaluate(async () => {
      const signal = AbortSignal.timeout(20_000);
      const response = await fetch("/api/k-nex/sales/routes/sales.route.accounts", { cache: "no-store", signal });
      return { status: response.status, body: await response.text() };
    }), "accounts list diagnostic");
    throw new Error(`${error}\nurl=${page.url()}\nbody=${await page.locator("body").innerText()}\nprojection=${JSON.stringify(projection)}`);
  }
  await link.focus();
  assert.equal(await link.evaluate((element) => element === document.activeElement), true);
  const [navigation] = await bounded(Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === path),
    page.keyboard.press("Enter")
  ]), `${path} keyboard navigation`);
  assert.equal(navigation.status(), 200, `${path} keyboard route returned ${navigation.status()}.`);
  await page.waitForURL(new RegExp(`${path.replaceAll("/", "\\/")}$`, "u"));
  await page.getByRole("heading", { name: expectedHeading(path), exact: true }).waitFor();
}

async function keyboardPage(page, direction, queryName, expectedPage, expectedText) {
  const control = page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: direction, exact: true });
  await control.focus();
  assert.equal(await control.evaluate((element) => element === document.activeElement), true, `${queryName} pagination must receive keyboard focus`);
  const [response] = await bounded(Promise.all([
    page.waitForResponse((candidate) => new URL(candidate.url()).searchParams.get(queryName) === String(expectedPage)),
    page.keyboard.press("Enter")
  ]), `${queryName} pagination response`);
  const body = await responseText(response, `${queryName} pagination response`);
  assert.equal(response.status(), 200, `${queryName} pagination returned ${response.status()}: ${body}`);
  try { await page.getByText(expectedText, { exact: false }).first().waitFor(); }
  catch (error) { throw new Error(`${error}\n${queryName}=${expectedPage} response=${body}\nhtml=${await page.locator("body").innerText()}`); }
}

async function submitTimelineAction(page, actionId, recordId) {
  const button = page.locator(`[data-action-id="${actionId}"][data-record-id="${recordId}"]`);
  await button.waitFor();
  await button.focus();
  assert.equal(await button.evaluate((element) => element === document.activeElement), true, `${actionId} must receive keyboard focus`);
  const [response] = await bounded(Promise.all([
    page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/k-nex/sales/actions/${actionId}`),
    page.keyboard.press("Enter")
  ]), `${actionId} timeline response`);
  const body = await responseText(response, `${actionId} timeline response`);
  assert.equal(response.status(), 200, `${actionId} returned ${response.status()}: ${body}`);
  const payload = JSON.parse(body);
  assert.equal(payload.action?.id, actionId);
  assert.equal(payload.data?.id, recordId);
  assert.equal(Number.isSafeInteger(payload.data?.revision), true);
  return payload.data;
}

async function assertRouteProjection(page, routeId, id, applicationOutput) {
  const result = await routeProjection(page, routeId, id);
  assert.equal(result.status, 200, `${routeId} projection failed: ${JSON.stringify(result.body)}\napplication=${applicationOutput()}`);
  return result.body;
}

function watchProtectedTraffic(page) {
  const origin = new URL(page.url()).origin;
  const bodies = [];
  const consoleMessages = [];
  const failures = [];
  const pending = new Set();
  const protectedRequest = (request) => {
    const url = new URL(request.url());
    return url.origin === origin && (url.pathname.startsWith("/sales") || url.pathname.includes("/api/k-nex/sales/")) && ["document", "fetch", "xhr"].includes(request.resourceType());
  };
  page.on("request", (request) => { if (protectedRequest(request)) pending.add(request); });
  page.on("requestfinished", (request) => {
    if (!protectedRequest(request)) return;
    pending.delete(request);
    bodies.push((async () => {
      const response = await request.response();
      if (response === null) throw new Error(`Protected ${request.resourceType()} request ${new URL(request.url()).pathname} finished without a response.`);
      const path = new URL(response.url()).pathname;
      const status = response.status();
      if (status === 204 || status === 304 || status >= 300 && status < 400) return "";
      return responseText(response, `protected ${path}`).catch((error) => { throw new Error(`Protected ${request.resourceType()} response ${status} ${path} body unavailable: ${String(error)}`); });
    })().catch((error) => { failures.push(error); return ""; }));
  });
  page.on("requestfailed", (request) => {
    if (!protectedRequest(request)) return;
    pending.delete(request);
    const errorText = request.failure()?.errorText ?? "unknown failure";
    // Route-runtime effect cleanup aborts an obsolete, response-less fetch during
    // navigation; it cannot expose a protected body. All other failures remain
    // evidence failures.
    if (request.resourceType() === "fetch" && errorText === "net::ERR_ABORTED") return;
    failures.push(new Error(`Protected ${request.resourceType()} request ${new URL(request.url()).pathname} failed: ${errorText}`));
  });
  page.on("console", (message) => { consoleMessages.push(message.text()); });
  page.on("pageerror", (error) => { consoleMessages.push(String(error)); });
  const checkpoint = async () => {
    await page.waitForTimeout(100);
    await eventually(() => pending.size === 0, `Protected requests did not finish: ${[...pending].map((request) => new URL(request.url()).pathname).join(", ")}`, 20_000);
    const captured = await bounded(Promise.all([...bodies]), "protected response bodies");
    if (failures.length > 0) throw new AggregateError([...failures], "Protected requests failed.");
    return captured;
  };
  return Object.freeze({ checkpoint, async result() {
    const captured = await checkpoint();
    return { traffic: captured.join("\n"), console: consoleMessages.join("\n") };
  } });
}

async function browserPersistence(page) {
  return bounded(page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    return {
      local: { ...localStorage }, session: { ...sessionStorage },
      cacheNames, indexedDbNames: databases.map((database) => database.name ?? "<unnamed>")
    };
  }), "browser persistence scan");
}

function watchRealtime(page, routeId) {
  const state = { sockets: 0, subscriptions: 0, invalidFrames: [], timelineFrames: [], projectionRequestStarts: [] };
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/socket.io/")) return;
    state.sockets += 1;
    socket.on("framesent", ({ payload }) => { if (String(payload).includes("k-nex:subscribe")) state.subscriptions += 1; });
    socket.on("framereceived", ({ payload }) => {
      const serialized = String(payload);
      const start = serialized.indexOf("[");
      if (start < 0) return;
      let frame;
      try { frame = JSON.parse(serialized.slice(start)); }
      catch { return; }
      if (frame?.[0] !== "k-nex:event") return;
      const envelope = frame[1];
      if (!Array.isArray(frame) || frame.length !== 2 || envelope === null || typeof envelope !== "object" || Array.isArray(envelope) ||
        Object.keys(envelope).sort().join("\0") !== "correlationId\0event\0messageClass\0topicId" ||
        typeof envelope.correlationId !== "string" || envelope.messageClass !== "reconstructible-invalidation" || typeof envelope.topicId !== "string") {
        state.invalidFrames.push(serialized);
        return;
      }
      if (envelope.topicId === "sales.realtime.timeline") state.timelineFrames.push({ topicId: envelope.topicId, at: performance.now() });
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== `/api/k-nex/sales/routes/${routeId}`) return;
    state.projectionRequestStarts.push(performance.now());
  });
  return state;
}

async function assertHidden(page, labels) {
  for (const label of labels) assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 0, `must hide ${label} at ${page.url()}`);
}

async function assertTimelineRow(page, label, status) {
  const row = page.getByText(label, { exact: true }).locator("xpath=ancestor::li");
  await row.waitFor();
  await row.getByText(status, { exact: false }).waitFor();
}

test("P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, applicationOutput }) => {
    const stage = (value) => process.stdout.write(`P13_3_CRM_BROWSER_STAGE ${value}\n`);
    const browser = await chromium.launch({ headless: true });
    try {
      stage("viewer-start");
      const viewer = await login(browser, origin, personas.viewer);
      const protectedTraffic = watchProtectedTraffic(viewer.page);
      const protectedHtml = [];
      const visitViewer = async (path, hiddenActions) => {
        await protectedTraffic.checkpoint();
        await accessible(viewer.page, path);
        const segments = new URL(path, origin).pathname.split("/").filter(Boolean);
        if (segments.length === 2) await viewer.page.getByRole("grid").waitFor();
        else await viewer.page.getByRole("region", { name: "Summary" }).waitFor();
        await assertHidden(viewer.page, hiddenActions);
        protectedHtml.push(await bounded(viewer.page.locator("html").innerHTML(), `${path} HTML`));
        await protectedTraffic.checkpoint();
      };
      await visitViewer("/sales/accounts", ["Account Create"]);
      await visitViewer(`/sales/accounts/${records.accountId}`, ["Account Update", "Account Archive", "Ownership Assign", "Activity Create", "Note Create", "Attachment Link"]);
      for (const value of ["activity:call: Complete browser activity", "note: Note", "attachment: browser.txt"]) await viewer.page.getByText(value, { exact: true }).first().waitFor();
      assert.equal(await viewer.page.locator("[data-action-id]").count(), 0, "viewer received a timeline mutation control");
      protectedHtml.push(await bounded(viewer.page.locator("html").innerHTML(), "account timeline HTML"));
      await visitViewer("/sales/contacts", ["Contact Create"]);
      await visitViewer(`/sales/contacts/${records.contactId}`, ["Contact Update", "Contact Archive", "Ownership Assign", "Activity Create", "Note Create", "Attachment Link"]);
      await visitViewer("/sales/leads", ["Lead Create"]);
      await visitViewer(`/sales/leads/${records.leadArchiveId}`, ["Lead Update", "Lead Qualify", "Lead Disqualify", "Lead Archive", "Ownership Assign", "Activity Create", "Note Create", "Attachment Link"]);
      await visitViewer("/sales/opportunities", ["Opportunity Create"]);
      await visitViewer(`/sales/opportunities/${records.opportunityLossId}`, ["Opportunity Update", "Opportunity Stage Update", "Opportunity Close", "Opportunity Archive", "Ownership Assign", "Activity Create", "Note Create", "Attachment Link"]);
      const hiddenProjection = await routeProjection(viewer.page, "sales.route.opportunity-detail", records.opportunityLossId);
      assert.equal(hiddenProjection.status, 200);
      const persistence = await browserPersistence(viewer.page);
      assert.deepEqual(persistence.cacheNames, [], "viewer CacheStorage must be empty or explicitly scanned");
      assert.deepEqual(persistence.indexedDbNames, [], "viewer IndexedDB must be empty or explicitly scanned");
      const observed = await protectedTraffic.result();
      const protectedSurfaces = [protectedHtml.join("\n"), JSON.stringify(hiddenProjection.body), observed.traffic, observed.console, JSON.stringify(persistence)];
      for (const secret of [records.contactEmail, records.contactPhone, records.leadEmail, records.leadPhone, records.noteBody, records.amount]) {
        for (const [index, surface] of protectedSurfaces.entries()) assert.equal(surface.includes(secret), false, `viewer protected surface ${index} leaked ${secret}`);
      }
      await viewer.context.close();
      stage("viewer-complete");

      stage("owner-start");
      const owner = await login(browser, origin, personas.owner);
      const realtime = watchRealtime(owner.page, "sales.route.account-detail");
      await accessible(owner.page, "/sales/accounts");
      const createdAccount = await submitAction(owner.page, "sales.account.create", { Name: "Browser created account" });
      assert.deepEqual({ revision: createdAccount.revision, status: createdAccount.status }, { revision: 1, status: "active" });
      await exactDetailProjection(owner.page, "sales.route.account-detail", createdAccount.id, { name: "Browser created account", status: "active", revision: 1 });
      await keyboardPage(owner.page, "Next", "page", 2, records.page2AccountName);
      await owner.page.getByText("Page 2", { exact: true }).waitFor();
      await keyboardPage(owner.page, "Previous", "page", 1, "Browser account");
      stage("list-pagination-complete");
      await keyboardDetail(owner.page, `/sales/accounts/${records.accountId}`, "Browser account");
      await owner.page.getByRole("heading", { name: "Account detail", exact: true }).waitFor();
      await eventually(() => realtime.subscriptions > 0, "account detail never subscribed to realtime", 10_000);
      stage("account-detail-loaded");
      for (const label of ["Ownership", "Timeline", "Tasks and reminders", "State history", "Authorized actions"]) await owner.page.getByRole("region", { name: label }).waitFor();
      try { await owner.page.getByText(records.noteBody).waitFor(); }
      catch (error) {
        const projection = await routeProjection(owner.page, "sales.route.account-detail", records.accountId);
        throw new Error(`${error}\nbody=${await owner.page.locator("body").innerText()}\nprojection=${JSON.stringify(projection)}`);
      }
      await assertRouteProjection(owner.page, "sales.route.account-detail", records.accountId, applicationOutput);
      stage("account-projection-ready");
      const timelineFrames = realtime.timelineFrames.length;
      const completedActivity = await submitTimelineAction(owner.page, "sales.activity.complete", records.activityId);
      await eventually(() => realtime.timelineFrames.length > timelineFrames, "timeline action produced no exact sales.realtime.timeline frame", 900);
      assert.deepEqual(realtime.invalidFrames, [], "Socket.IO k-nex:event frames must use the exact closed realtime envelope");
      const timelineFrameAt = realtime.timelineFrames.at(-1).at;
      await eventually(() => realtime.projectionRequestStarts.some((at) => at > timelineFrameAt && at - timelineFrameAt < 900), "timeline frame produced no post-frame sub-900ms authoritative refetch request", 900);
      await assertTimelineRow(owner.page, "activity:call: Complete browser activity", "completed");
      const completedProjection = await assertRouteProjection(owner.page, "sales.route.account-detail", records.accountId, applicationOutput);
      assert.equal(cellValue(timelineProjectionRecord(completedProjection, `activity:${records.activityId}`)?.values.revision), completedActivity.revision);
      stage("activity-complete");
      const cancelledActivity = await submitTimelineAction(owner.page, "sales.activity.cancel", records.activityCancelId);
      await assertTimelineRow(owner.page, "activity:call: Cancel browser activity", "cancelled");
      const cancelledProjection = await assertRouteProjection(owner.page, "sales.route.account-detail", records.accountId, applicationOutput);
      assert.equal(cellValue(timelineProjectionRecord(cancelledProjection, `activity:${records.activityCancelId}`)?.values.revision), cancelledActivity.revision);
      stage("activity-cancel");
      const removedAttachment = await submitTimelineAction(owner.page, "sales.attachment.remove", records.attachmentId);
      stage("attachment-remove");
      stage("attachment-projection-start");
      await bounded(assertRouteProjection(owner.page, "sales.route.account-detail", records.accountId, applicationOutput), "attachment projection");
      stage("attachment-projection-complete");
      const removedRow = (await pool.query("select status,revision from sales_attachment_references where id=$1", [removedAttachment.id])).rows[0];
      assert.deepEqual(removedRow, { status: "removed", revision: removedAttachment.revision });
      await eventually(async () => await owner.page.locator(`[data-record-id="${records.attachmentId}"]`).count() === 0, "removed attachment action remained reachable after authoritative refresh");
      const page2Projection = await routeProjection(owner.page, "sales.route.account-detail", records.accountId, "&timelinePage=2");
      assert.equal(page2Projection.status, 200, JSON.stringify(page2Projection.body));
      assert.equal(JSON.stringify(page2Projection.body).includes(records.page2TimelineBody), true, JSON.stringify(page2Projection.body));
      stage("timeline-page2-projection-complete");
      const timelinePagination = owner.page.getByRole("navigation", { name: "Pagination" });
      assert.equal(await timelinePagination.count(), 1, `detail pagination controls=${await timelinePagination.allInnerTexts()}`);
      assert.equal(await timelinePagination.getByRole("button", { name: "Next", exact: true }).isDisabled(), false, await timelinePagination.innerText());
      stage("timeline-pagination-start");
      await bounded(keyboardPage(owner.page, "Next", "timelinePage", 2, records.page2TimelineBody), "timeline pagination");
      await owner.page.getByText("Page 2", { exact: true }).waitFor();
      stage("timeline-pagination-complete");
      await submitAction(owner.page, "sales.account.update", { Name: "Browser-updated account" });

      await accessible(owner.page, "/sales/contacts");
      const createdContact = await submitAction(owner.page, "sales.contact.create", { "Account ID": records.accountId, "Display name": "Browser created contact", Email: "browser-contact@example.test", Phone: "+15550100991" });
      assert.deepEqual({ revision: createdContact.revision, status: createdContact.status }, { revision: 1, status: "active" });
      await exactDetailProjection(owner.page, "sales.route.contact-detail", createdContact.id, { "display-name": "Browser created contact", "account-id": records.accountId, email: "browser-contact@example.test", phone: "+15550100991", status: "active", revision: 1 });
      await accessible(owner.page, `/sales/contacts/${records.contactId}`);
      await owner.page.getByRole("region", { name: "Relations" }).waitFor();
      await owner.page.getByText(records.contactEmail, { exact: true }).waitFor();
      await submitAction(owner.page, "sales.contact.update", { "Display name": "Browser-updated contact" });

      await accessible(owner.page, "/sales/leads");
      const createdLead = await submitAction(owner.page, "sales.lead.create", { "Display name": "Browser created lead", Source: "browser", Email: "browser-lead@example.test", Phone: "+15550100992" });
      assert.deepEqual({ revision: createdLead.revision, status: createdLead.status }, { revision: 1, status: "new" });
      await exactDetailProjection(owner.page, "sales.route.lead-detail", createdLead.id, { "display-name": "Browser created lead", source: "browser", email: "browser-lead@example.test", phone: "+15550100992", status: "new", revision: 1 });
      await accessible(owner.page, `/sales/leads/${records.leadQualifyId}`);
      const qualified = await submitAction(owner.page, "sales.lead.qualify", { "Account name": "Qualified browser account", "Contact name": "Qualified browser contact", "Opportunity name": "Qualified browser opportunity", "Pipeline ID": records.pipelineId }, { terminal: true });
      assert.deepEqual({ id: qualified.id, status: qualified.status }, { id: records.leadQualifyId, status: "qualified" });
      const createdLineage = (await pool.query(`select l.qualified_account_id,l.qualified_contact_id,l.qualified_opportunity_id,l.owner_id,l.team_id,
        a.status account_status,a.owner_id account_owner_id,a.team_id account_team_id,
        c.account_id contact_account_id,c.owner_id contact_owner_id,c.team_id contact_team_id,
        o.account_id opportunity_account_id,o.primary_contact_id,o.owner_id opportunity_owner_id,o.team_id opportunity_team_id
        from sales_leads l
        join sales_accounts a on a.id::text=l.qualified_account_id and a.application_id=l.application_id and a.environment=l.environment
        join sales_contacts c on c.id::text=l.qualified_contact_id and c.application_id=l.application_id and c.environment=l.environment
        join sales_opportunities o on o.id::text=l.qualified_opportunity_id and o.application_id=l.application_id and o.environment=l.environment
        where l.id=$1`, [records.leadQualifyId])).rows[0];
      assert.deepEqual([String(createdLineage.qualified_account_id), String(createdLineage.qualified_contact_id), String(createdLineage.qualified_opportunity_id)], [qualified.accountId, qualified.contactId, qualified.opportunityId]);
      assert.deepEqual([String(createdLineage.contact_account_id), String(createdLineage.opportunity_account_id), String(createdLineage.primary_contact_id)], [qualified.accountId, qualified.accountId, qualified.contactId]);
      assert.deepEqual([createdLineage.account_status, createdLineage.account_owner_id, createdLineage.account_team_id, createdLineage.contact_owner_id, createdLineage.contact_team_id, createdLineage.opportunity_owner_id, createdLineage.opportunity_team_id], ["active", createdLineage.owner_id, createdLineage.team_id, createdLineage.owner_id, createdLineage.team_id, createdLineage.owner_id, createdLineage.team_id]);
      const qualifiedProjection = await exactDetailProjection(owner.page, "sales.route.lead-detail", records.leadQualifyId, { "qualified-account-id": qualified.accountId, "qualified-contact-id": qualified.contactId, "qualified-opportunity-id": qualified.opportunityId, revision: qualified.revision });
      for (const [label, id] of [["View qualified account", qualified.accountId], ["View qualified contact", qualified.contactId], ["View qualified opportunity", qualified.opportunityId]]) {
        await eventually(async () => await owner.page.locator(`a[aria-label="${label}"][href$="/${id}"]`).count() === 1, `${label} did not render authoritative lineage.`);
      }
      assert.ok(qualifiedProjection.record);
      await assertHidden(owner.page, ["Lead Update", "Lead Qualify", "Lead Disqualify", "Ownership Assign"]);
      await submitAction(owner.page, "sales.lead.archive", {}, { terminal: true });
      assert.equal(await owner.page.getByRole("button", { name: "Lead Archive", exact: true }).count(), 0);
      await accessible(owner.page, `/sales/leads/${records.leadArchiveId}`);
      await submitAction(owner.page, "sales.lead.update", { "Display name": "Browser-updated lead", Source: "browser-update" });
      const disqualified = await submitAction(owner.page, "sales.lead.disqualify", {}, { terminal: true });
      assert.equal(disqualified.status, "disqualified");
      await assertHidden(owner.page, ["Lead Update", "Lead Qualify", "Lead Disqualify", "Ownership Assign"]);
      await eventually(async () => await owner.page.getByRole("button", { name: "Lead Archive", exact: true }).count() === 1, "disqualified lead did not regain its permitted archive action after authoritative refresh");
      await submitAction(owner.page, "sales.lead.archive", {}, { terminal: true });

      await accessible(owner.page, "/sales/opportunities");
      const createdOpportunity = await submitAction(owner.page, "sales.opportunity.create", { Name: "Browser created opportunity", "Account ID": records.accountId, "Pipeline ID": records.pipelineId, "Stage ID": "qualification" });
      assert.deepEqual({ revision: createdOpportunity.revision, status: createdOpportunity.status }, { revision: 1, status: "qualification" });
      await exactDetailProjection(owner.page, "sales.route.opportunity-detail", createdOpportunity.id, { name: "Browser created opportunity", "account-id": records.accountId, "pipeline-id": records.pipelineId, "stage-id": "qualification", revision: 1 });
      await accessible(owner.page, `/sales/opportunities/${records.opportunityWinId}`);
      await submitAction(owner.page, "sales.opportunity.update", { Name: "Browser-updated opportunity" });
      const won = await submitAction(owner.page, "sales.opportunity.close", { Stage: "won" }, { terminal: true });
      assert.equal(won.status, "won");
      await assertHidden(owner.page, ["Opportunity Update", "Opportunity Stage Update", "Opportunity Close", "Ownership Assign"]);
      assert.equal(await owner.page.getByRole("button", { name: "Note Create", exact: true }).count(), 1, "terminal opportunity keeps permitted interactions");
      assert.equal(await owner.page.getByRole("button", { name: "Opportunity Archive", exact: true }).count(), 1, "won opportunity remains archivable");
      await submitAction(owner.page, "sales.opportunity.archive", {}, { terminal: true });
      assert.equal(await owner.page.getByRole("button", { name: "Opportunity Archive", exact: true }).count(), 0);
      await accessible(owner.page, `/sales/opportunities/${records.opportunityLossId}`);
      await submitAction(owner.page, "sales.opportunity.stage.update", { Stage: "discovery" });
      await submitAction(owner.page, "sales.opportunity.stage.update", { Stage: "proposal" });
      await submitAction(owner.page, "sales.opportunity.stage.update", { Stage: "negotiation" });
      const lost = await submitAction(owner.page, "sales.opportunity.close", { Stage: "lost", "Loss reason": "Browser loss" }, { terminal: true });
      assert.equal(lost.status, "lost");
      await assertHidden(owner.page, ["Opportunity Update", "Opportunity Stage Update", "Opportunity Close", "Ownership Assign"]);
      assert.equal(await owner.page.getByRole("button", { name: "Opportunity Archive", exact: true }).count(), 1, "lost opportunity remains archivable");
      await submitAction(owner.page, "sales.opportunity.archive", {}, { terminal: true });
      assert.equal(await owner.page.getByRole("button", { name: "Opportunity Archive", exact: true }).count(), 0);
      await accessible(owner.page, `/sales/opportunities/${records.opportunityArchiveId}`);
      await submitAction(owner.page, "sales.opportunity.archive", {}, { terminal: true });
      for (const label of ["Opportunity Update", "Opportunity Stage Update", "Opportunity Close", "Opportunity Archive", "Ownership Assign"]) assert.equal(await owner.page.getByRole("button", { name: label, exact: true }).count(), 0, `archived opportunity must hide ${label}`);
      const linker = await login(browser, origin, personas.linker);
      await accessible(linker.page, `/sales/leads/${records.linkerLeadId}`);
      assert.equal(await linker.page.getByRole("button", { name: "Note Create", exact: true }).count(), 0, "linker lacks notes.write");
      await submitDeniedAction(linker.page, "sales.lead.qualify", { "Account name": "Forbidden created account", "Contact name": "Forbidden created contact", "Opportunity name": "Forbidden opportunity", "Pipeline ID": records.pipelineId });
      const linked = await submitAction(linker.page, "sales.lead.qualify", { "Account mode": "link", "Account ID": records.accountId, "Contact mode": "link", "Contact ID": records.contactId, "Opportunity name": "Linked browser opportunity", "Pipeline ID": records.pipelineId }, { terminal: true });
      assert.deepEqual({ accountId: linked.accountId, contactId: linked.contactId }, { accountId: records.accountId, contactId: records.contactId });
      const linkedLineage = (await pool.query(`select l.qualified_account_id,l.qualified_contact_id,l.qualified_opportunity_id,l.owner_id,l.team_id,a.status account_status,c.account_id,c.status contact_status,o.account_id opportunity_account_id,o.primary_contact_id,o.owner_id opportunity_owner_id,o.team_id opportunity_team_id
        from sales_leads l
        join sales_accounts a on a.id::text=l.qualified_account_id and a.application_id=l.application_id and a.environment=l.environment
        join sales_contacts c on c.id::text=l.qualified_contact_id and c.application_id=l.application_id and c.environment=l.environment
        join sales_opportunities o on o.id::text=l.qualified_opportunity_id and o.application_id=l.application_id and o.environment=l.environment
        where l.id=$1`, [records.linkerLeadId])).rows[0];
      assert.deepEqual([String(linkedLineage.qualified_account_id), String(linkedLineage.qualified_contact_id), String(linkedLineage.qualified_opportunity_id)], [linked.accountId, linked.contactId, linked.opportunityId]);
      assert.deepEqual([linkedLineage.account_status, String(linkedLineage.account_id), linkedLineage.contact_status, String(linkedLineage.opportunity_account_id), String(linkedLineage.primary_contact_id)], ["active", records.accountId, "active", records.accountId, records.contactId]);
      assert.deepEqual([linkedLineage.opportunity_owner_id, linkedLineage.opportunity_team_id], [linkedLineage.owner_id, linkedLineage.team_id]);
      await exactDetailProjection(linker.page, "sales.route.lead-detail", records.linkerLeadId, { "qualified-account-id": records.accountId, "qualified-contact-id": records.contactId, "qualified-opportunity-id": linked.opportunityId, revision: linked.revision });
      await assertHidden(linker.page, ["Lead Update", "Lead Qualify", "Lead Disqualify", "Lead Archive", "Ownership Assign", "Note Create"]);
      await linker.context.close();
      stage("linker-complete");

      await accessible(owner.page, `/sales/contacts/${records.contactId}`);
      await submitAction(owner.page, "sales.contact.archive", {}, { terminal: true });
      await assertHidden(owner.page, ["Contact Update", "Contact Archive", "Ownership Assign"]);
      await accessible(owner.page, `/sales/accounts/${records.accountId}`);
      await submitAction(owner.page, "sales.account.archive", {}, { terminal: true });
      await assertHidden(owner.page, ["Account Update", "Account Archive", "Ownership Assign"]);
      assert.equal(await owner.page.getByRole("button", { name: "Note Create", exact: true }).count(), 1, "archived account keeps permitted interactions");
      await owner.context.close();
      stage("account-archive-complete");

      const manager = await login(browser, origin, personas.manager);
      await accessible(manager.page, `/sales/accounts/${records.managerAccountId}`);
      await submitAction(manager.page, "sales.account.update", { Name: "Manager browser account" });
      await submitAction(manager.page, "sales.ownership.assign", { "Owner ID": records.candidateOwnerId, "Team ID": "" }, { expectProjection: false, expectConfirmation: false });
      await eventually(async () => {
        const revoked = await routeProjection(manager.page, "sales.route.account-detail", records.managerAccountId);
        assert.deepEqual(revoked, { status: 404, body: { code: "NOT_FOUND" } });
        return true;
      }, "ownership transfer did not revoke the manager's exact-record projection");
      await eventually(async () => await manager.page.getByRole("alert").count() > 0, "ownership transfer left the prior detail visible");
      await eventually(async () => await Promise.all(["Account Update", "Account Archive", "Ownership Assign"].map((label) => manager.page.getByRole("button", { name: label, exact: true }).count())).then((counts) => counts.every((count) => count === 0)), "ownership transfer left mutation controls visible");
      const managerDenied = await routeProjection(manager.page, "sales.route.account-detail", records.accountId);
      assert.deepEqual(managerDenied, { status: 404, body: { code: "NOT_FOUND" } }, "manager escaped managed-team-and-own non-enumeration scope");

      const representative = await login(browser, origin, personas.representative);
      await accessible(representative.page, "/sales/accounts");
      await keyboardDetail(representative.page, `/sales/accounts/${records.repAccountId}`, "Representative account");
      await submitAction(representative.page, "sales.account.update", { Name: "Representative browser account" });
      await assertHidden(representative.page, ["Account Archive", "Ownership Assign"]);
      const repActivity = await submitAction(representative.page, "sales.activity.create", { "Activity type": "call", Subject: "Representative browser activity", "Scheduled at": "2026-09-20T10:00:00.000Z" });
      const repActivityLineage = (await pool.query(`select a.owner_id,a.team_id,a.created_by,a.actor_id,a.related_record_type,a.related_record_id,r.owner_id account_owner_id,r.team_id account_team_id
        from sales_activities a
        join sales_accounts r on r.id::text=a.related_record_id and r.application_id=a.application_id and r.environment=a.environment
        where a.id=$1`, [repActivity.id])).rows[0];
      assert.deepEqual(repActivityLineage, {
        owner_id: records.representativeActorId, team_id: `team:${records.representativeActorId}`,
        created_by: records.representativeActorId, actor_id: records.representativeActorId,
        related_record_type: "sales.account", related_record_id: records.repAccountId,
        account_owner_id: records.representativeActorId, account_team_id: `team:${records.representativeActorId}`
      });
      const representativeDenied = await routeProjection(representative.page, "sales.route.account-detail", createdAccount.id);
      assert.deepEqual(representativeDenied, { status: 404, body: { code: "NOT_FOUND" } }, "representative escaped owned-or-assigned-team non-enumeration scope");
      await accessible(representative.page, `/sales/opportunities/${records.repOpportunityId}`);
      assert.equal(await representative.page.getByText(`${records.repOpportunityAmount} ${records.repOpportunityCurrency}`, { exact: true }).count(), 0, "representative without amount.read saw opportunity amount");
      for (const label of ["Amount mode", "Amount", "Currency", "Scale"]) assert.equal(await representative.page.getByLabel(label, { exact: true }).count(), 0, `representative received ${label}`);
      await assertHidden(representative.page, ["Opportunity Close", "Opportunity Archive", "Ownership Assign"]);
      assert.equal(await representative.page.getByRole("button", { name: "Opportunity Stage Update", exact: true }).count(), 1);
      const repStage = await submitAction(representative.page, "sales.opportunity.stage.update", { Stage: "discovery" });
      assert.equal(repStage.stage, "discovery");
      await representative.context.close();
      stage("representative-complete");

      await accessible(manager.page, `/sales/opportunities/${records.repOpportunityId}`);
      await manager.page.getByText(`${records.repOpportunityAmount} ${records.repOpportunityCurrency}`, { exact: true }).waitFor();
      assert.deepEqual((await exactDetailProjection(manager.page, "sales.route.opportunity-detail", records.repOpportunityId)).record.values.amount, { kind: "money", value: records.repOpportunityAmount, currency: records.repOpportunityCurrency, scale: 2 });
      const managedClose = await submitAction(manager.page, "sales.opportunity.close", { Stage: "lost", "Loss reason": "Managed-team closure" }, { terminal: true });
      assert.equal(managedClose.status, "lost");
      assert.equal(await manager.page.getByRole("button", { name: "Opportunity Archive", exact: true }).count(), 1);
      await submitAction(manager.page, "sales.opportunity.archive", {}, { terminal: true });
      await manager.context.close();
      stage("manager-complete");
    } finally {
      await browser.close();
      stage("browser-closed");
    }
  });
});
