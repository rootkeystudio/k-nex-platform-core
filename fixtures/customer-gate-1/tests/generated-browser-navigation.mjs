import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { errors as playwrightErrors } from "playwright";

const hydrationReadinessBudgetMs = 30_000;
const maximumTelemetryEvents = 32;
const routeTelemetry = new WeakMap();

const generatedSalesRoutes = new Map([
  ["/sales", "sales.route.overview"],
  ["/sales/tasks", "sales.route.tasks"],
  ["/sales/opportunities", "sales.route.opportunities"],
  ["/sales/settings", "sales.route.settings"]
]);

function generatedSalesRoute(url) {
  const requestedUrl = new URL(url);
  assert.equal(requestedUrl.username, "", "Generated route URL must not contain userinfo.");
  assert.equal(requestedUrl.password, "", "Generated route URL must not contain userinfo.");
  assert.equal(requestedUrl.search, "", "Generated route URL must not contain a query.");
  assert.equal(requestedUrl.hash, "", "Generated route URL must not contain a hash.");
  const routeId = generatedSalesRoutes.get(requestedUrl.pathname);
  assert.notEqual(routeId, undefined, `Generated route is not registered: ${requestedUrl.pathname}`);
  return Object.freeze({
    canonicalUrl: requestedUrl.href,
    projectionUrl: new URL(`/api/k-nex/sales/routes/${encodeURIComponent(routeId)}?page=1`, requestedUrl).href
  });
}

export function waitForGeneratedRouteProjection(page, url, status) {
  assert.ok(status === 200 || status === 404, "Generated route projection status must be 200 or 404.");
  const { projectionUrl } = generatedSalesRoute(url);
  return page.waitForResponse((response) => response.url() === projectionUrl && response.status() === status, { timeout: 30_000 });
}

function diagnosticDigest(value) {
  return createHash("sha256").update(String(value).slice(0, 4_096)).digest("hex").slice(0, 16);
}

function attachGeneratedRouteTelemetry(page, projectionUrl, now) {
  routeTelemetry.get(page)?.detach();
  const started = now();
  let lastElapsed = 0;
  const events = [];
  const record = (value) => {
    lastElapsed = Math.max(lastElapsed, Math.floor(now() - started), 0);
    if (events.length < maximumTelemetryEvents) events.push(`+${lastElapsed}ms:${value}`);
  };
  const response = (observed) => {
    if (observed.url() !== projectionUrl) return;
    const serverTiming = observed.headers()["server-timing"];
    const timing = typeof serverTiming === "string" && /^knex;dur=[0-9]+(?:[.][0-9]+)?$/u.test(serverTiming) ? `:${serverTiming}` : "";
    record(`projection:${observed.status()}${timing}`);
  };
  const requestFailed = (request) => {
    if (request.url() === projectionUrl) record(`projection-failed:sha256:${diagnosticDigest(request.failure()?.errorText ?? "unknown")}`);
  };
  const pageError = (error) => record(`pageerror:${error?.name === "Error" ? "Error" : "Other"}:sha256:${diagnosticDigest(error?.message ?? error)}`);
  const consoleError = (message) => { if (message.type() === "error") record(`console-error:sha256:${diagnosticDigest(message.text())}`); };
  let detached = false;
  const close = () => detach();
  const detach = () => {
    if (detached) return;
    detached = true;
    page.off("response", response);
    page.off("requestfailed", requestFailed);
    page.off("pageerror", pageError);
    page.off("console", consoleError);
    page.off("close", close);
    if (routeTelemetry.get(page)?.detach === detach) routeTelemetry.delete(page);
  };
  page.on("response", response);
  page.on("requestfailed", requestFailed);
  page.on("pageerror", pageError);
  page.on("console", consoleError);
  page.on("close", close);
  const telemetry = Object.freeze({ detach, describe: () => events.length === 0 ? "none" : events.join(",") });
  routeTelemetry.set(page, telemetry);
  return telemetry;
}

function generatedRouteTelemetry(page) {
  return routeTelemetry.get(page)?.describe() ?? "none";
}

export async function proveGeneratedSalesTaskRouteHydration(page, diagnostics, now = Date.now) {
  try {
    const deadline = now() + hydrationReadinessBudgetMs;
    const remaining = () => Math.max(0, deadline - now());
    const operationTimeout = () => {
      const available = remaining();
      assert.ok(available > 0, "Generated Sales Task hydration exceeded its thirty-second readiness deadline.");
      return Math.min(1_000, available);
    };
    const form = page.getByRole("form", { name: "Create task" });
    const title = form.getByRole("textbox", { name: "Title" });
    const submit = form.getByRole("button", { name: "Create task" });
    assert.equal(await submit.isDisabled({ timeout: operationTimeout() }), true, "Generated Sales Task submit must start disabled.");
    const hasAttemptBudget = () => remaining() >= 5_100;
    let hydrated = false;
    while (!hydrated && hasAttemptBudget()) {
      try {
        await title.fill("", { timeout: operationTimeout() });
        await title.fill("Hydration readiness", { timeout: operationTimeout() });
        hydrated = await submit.isEnabled({ timeout: operationTimeout() });
      } catch (error) {
        if (!(error instanceof playwrightErrors.TimeoutError)) throw error;
      }
      if (!hydrated) await page.waitForTimeout(Math.min(100, remaining()));
    }
    assert.equal(hydrated, true, "Generated Sales Task form did not accept a React-owned title transition.");
    await title.fill("", { timeout: operationTimeout() });
    assert.equal(await submit.isDisabled({ timeout: operationTimeout() }), true, "Generated Sales Task form was not restored.");
  } catch (error) {
    const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "unavailable");
    const telemetry = generatedRouteTelemetry(page);
    routeTelemetry.get(page)?.detach();
    throw new Error(`${error}\nurl=${page.url()}\nrouteTelemetry=${telemetry}\nbody=${body}\nprocess=${diagnostics()}`);
  }
}

export async function navigateGeneratedRouteToReady(page, url, ready, diagnostics, now = () => performance.now()) {
  const { canonicalUrl, projectionUrl } = generatedSalesRoute(url);
  const telemetry = attachGeneratedRouteTelemetry(page, projectionUrl, now);
  try {
    const response = await page.goto(canonicalUrl, { waitUntil: "commit", timeout: 30_000 });
    assert.equal(response?.status(), 200, `Generated route returned ${response?.status() ?? "no response"}: ${canonicalUrl}`);
    assert.equal(response.url(), canonicalUrl, "Generated route response must not redirect.");
    assert.equal(page.url(), canonicalUrl, "Generated route page must remain at the requested URL.");
    await ready().waitFor({ timeout: 30_000 });
    return response;
  } catch (error) {
    const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "unavailable");
    const routeDiagnostics = telemetry.describe();
    telemetry.detach();
    throw new Error(`${error}\nurl=${page.url()}\nrouteTelemetry=${routeDiagnostics}\nbody=${body}\nprocess=${diagnostics()}`);
  }
}
