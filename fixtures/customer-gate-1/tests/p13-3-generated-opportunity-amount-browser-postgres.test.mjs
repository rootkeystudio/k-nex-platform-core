import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function bounded(promise, label, timeoutMs = 20_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

async function login(browser, origin, persona) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const response = await bounded(page.goto(`${origin}/login`), "amount login route");
  assert.equal(response?.status(), 200);
  await page.getByLabel("Email").fill(persona.email);
  await page.getByLabel("Password").fill(persona.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
  return { context, page };
}

async function opportunityProjection(page, id) {
  return bounded(page.evaluate(async (recordId) => {
    const signal = AbortSignal.timeout(20_000);
    const response = await fetch(`/api/k-nex/sales/routes/sales.route.opportunity-detail?id=${encodeURIComponent(recordId)}`, { cache: "no-store", signal });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); }
    catch { throw new Error(`Opportunity amount projection returned non-JSON: ${text}`); }
    return { status: response.status, body };
  }, id), "opportunity amount projection");
}

function amountCell(projection) {
  for (const result of Object.values(projection.sourceResults ?? {})) {
    const data = result?.data;
    if (!Array.isArray(data?.fields) || !data.fields.includes("amount") || !Array.isArray(data.rows) || data.rows.length !== 1) continue;
    return data.rows[0]?.values?.amount;
  }
  return undefined;
}

function assertNoAmountProjection(projection) {
  for (const result of Object.values(projection.sourceResults ?? {})) {
    const data = result?.data;
    if (data === null || typeof data !== "object" || Array.isArray(data)) continue;
    if (Array.isArray(data.fields)) assert.equal(data.fields.includes("amount"), false, "representative source selected amount");
    if (!Array.isArray(data.rows)) continue;
    for (const row of data.rows) {
      if (row === null || typeof row !== "object" || Array.isArray(row) || row.values === null || typeof row.values !== "object" || Array.isArray(row.values)) continue;
      assert.equal(Object.hasOwn(row.values, "amount"), false, "representative source projected amount");
    }
  }
}

async function browserPersistence(page) {
  return bounded(page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    return {
      local: { ...localStorage }, session: { ...sessionStorage },
      cacheNames, indexedDbNames: databases.map((database) => database.name ?? "<unnamed>")
    };
  }), "opportunity amount browser persistence scan");
}

test("P13.3 generated opportunity detail selects amount only for the exact field grant", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const owner = await login(browser, origin, personas.owner);
      const manager = await login(browser, origin, personas.manager);
      const representative = await login(browser, origin, personas.representative);
      const target = records.opportunityWinId;
      for (const [session, sessionTarget, amount, currency] of [
        [owner, target, records.amount, "USD"],
        [manager, records.managerOpportunityId, records.managerOpportunityAmount, records.managerOpportunityCurrency]
      ]) {
        const response = await opportunityProjection(session.page, sessionTarget);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.deepEqual(amountCell(response.body), { kind: "money", value: amount, currency, scale: 2 });
        await session.page.goto(`${origin}/sales/opportunities/${sessionTarget}`);
        await session.page.getByRole("heading", { name: "Opportunity detail", exact: true }).waitFor();
        await session.page.getByText(`${amount} ${currency}`, { exact: true }).waitFor();
      }
      const managerDenied = await opportunityProjection(manager.page, target);
      assert.equal(managerDenied.status, 404, "manager cross-scope record must remain non-enumerable");
      assert.deepEqual(managerDenied.body, { code: "NOT_FOUND" });

      const response = await opportunityProjection(representative.page, records.repOpportunityId);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(amountCell(response.body), undefined);
      assertNoAmountProjection(response.body);
      const projectionJson = JSON.stringify(response.body);
      assert.equal(projectionJson.includes(records.repOpportunityAmount), false);
      assert.equal(projectionJson.includes('"amount"'), false);
      await representative.page.goto(`${origin}/sales/opportunities/${records.repOpportunityId}`);
      await representative.page.getByRole("heading", { name: "Opportunity detail", exact: true }).waitFor();
      assert.equal(await representative.page.getByText(`${records.repOpportunityAmount} ${records.repOpportunityCurrency}`, { exact: true }).count(), 0, "representative amount UI leaked exact money value");
      for (const label of ["Amount mode", "Amount", "Currency", "Scale"]) assert.equal(await representative.page.getByLabel(label, { exact: true }).count(), 0, `representative received ${label}`);
      const html = await representative.page.content();
      const browserState = await browserPersistence(representative.page);
      assert.equal(html.includes(records.repOpportunityAmount), false);
      assert.deepEqual(browserState.cacheNames, [], "representative CacheStorage must be empty");
      assert.deepEqual(browserState.indexedDbNames, [], "representative IndexedDB must be empty");
      const browserStateJson = JSON.stringify(browserState);
      assert.equal(browserStateJson.includes(records.repOpportunityAmount), false);
      await Promise.all([owner.context.close(), manager.context.close(), representative.context.close()]);
    } finally {
      await browser.close();
    }
  });
});
