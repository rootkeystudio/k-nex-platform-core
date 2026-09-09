import assert from "node:assert/strict";
import { errors as playwrightErrors } from "playwright";

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

export async function proveGeneratedSalesTaskRouteHydration(page, diagnostics, now = Date.now) {
  try {
    const deadline = now() + 10_000;
    const remaining = () => Math.max(0, deadline - now());
    const operationTimeout = () => {
      const available = remaining();
      assert.ok(available > 0, "Generated Sales Task hydration exceeded its ten-second deadline.");
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
    throw new Error(`${error}\nurl=${page.url()}\nbody=${body}\nprocess=${diagnostics()}`);
  }
}

export async function navigateGeneratedRouteToReady(page, url, ready, diagnostics) {
  const { canonicalUrl } = generatedSalesRoute(url);
  try {
    const response = await page.goto(canonicalUrl, { waitUntil: "commit", timeout: 30_000 });
    assert.equal(response?.status(), 200, `Generated route returned ${response?.status() ?? "no response"}: ${canonicalUrl}`);
    assert.equal(response.url(), canonicalUrl, "Generated route response must not redirect.");
    assert.equal(page.url(), canonicalUrl, "Generated route page must remain at the requested URL.");
    await ready().waitFor({ timeout: 30_000 });
    return response;
  } catch (error) {
    const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "unavailable");
    throw new Error(`${error}\nurl=${page.url()}\nbody=${body}\nprocess=${diagnostics()}`);
  }
}
