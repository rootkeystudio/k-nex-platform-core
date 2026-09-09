import assert from "node:assert/strict";
import test from "node:test";
import { errors as playwrightErrors } from "playwright";

import { navigateGeneratedRouteToReady, proveGeneratedSalesTaskRouteHydration, waitForGeneratedRouteProjection } from "./generated-browser-navigation.mjs";

function pageFixture({ status = 200, responseUrl = "http://fixture.test/sales/tasks", pageUrl = responseUrl, projectionUrl = "http://fixture.test/api/k-nex/sales/routes/sales.route.tasks?page=1", projectionStatus = 200, readyError } = {}) {
  const calls = [];
  return {
    calls,
    async goto(url, options) {
      calls.push(["goto", url, options]);
      return { status: () => status, url: () => responseUrl };
    },
    waitForResponse(predicate, options) {
      calls.push(["projection", options]);
      const response = { status: () => projectionStatus, url: () => projectionUrl };
      assert.equal(predicate(response), true);
      return Promise.resolve(response);
    },
    url: () => pageUrl,
    locator: () => ({ innerText: async (options) => { calls.push(["body", options]); return "fixture body"; } }),
    ready: () => ({ waitFor: async (options) => { calls.push(["ready", options]); if (readyError !== undefined) throw readyError; } })
  };
}

test("generated route navigation waits for response commit and semantic readiness with finite bounds", async () => {
  for (const pathname of ["/sales", "/sales/tasks", "/sales/opportunities", "/sales/settings"]) {
    const requestedUrl = `http://fixture.test${pathname}`;
    const routeId = new Map([["/sales", "sales.route.overview"], ["/sales/tasks", "sales.route.tasks"], ["/sales/opportunities", "sales.route.opportunities"], ["/sales/settings", "sales.route.settings"]]).get(pathname);
    const page = pageFixture({ responseUrl: requestedUrl, projectionUrl: `http://fixture.test/api/k-nex/sales/routes/${routeId}?page=1` });
    const response = await navigateGeneratedRouteToReady(page, requestedUrl, page.ready, () => "fixture process");
    assert.equal(response.status(), 200);
    assert.deepEqual(page.calls, [
      ["goto", requestedUrl, { waitUntil: "commit", timeout: 30_000 }],
      ["ready", { timeout: 30_000 }]
    ]);
  }
});

test("generated Sales Task hydration retries a transient locator timeout plus an ignored pre-hydration event", async () => {
  const calls = [];
  let hydrated = false;
  let enabled = false;
  let timeoutNextFill = true;
  let waits = 0;
  const page = {
    getByRole(role, options) {
      assert.deepEqual([role, options], ["form", { name: "Create task" }]);
      return {
        getByRole(childRole, childOptions) {
          if (childRole === "textbox") return { fill: async (value, fillOptions) => {
            calls.push(["fill", value, fillOptions.timeout]);
            if (timeoutNextFill) { timeoutNextFill = false; throw new playwrightErrors.TimeoutError("controlled locator timeout"); }
            if (hydrated) enabled = value !== "";
          } };
          assert.deepEqual([childRole, childOptions], ["button", { name: "Create task" }]);
          return {
            isDisabled: async (stateOptions) => { calls.push(["disabled", stateOptions?.timeout]); return !enabled; },
            isEnabled: async (stateOptions) => { calls.push(["enabled", stateOptions.timeout, enabled]); return enabled; }
          };
        }
      };
    },
    locator(selector) {
      assert.equal(selector, "body");
      return { innerText: async () => "fixture body" };
    },
    waitForTimeout: async (duration) => { calls.push(["wait", duration]); waits += 1; hydrated = waits === 2; },
    url: () => "http://fixture.test/sales/tasks"
  };
  await proveGeneratedSalesTaskRouteHydration(page, () => "fixture process");
  assert.deepEqual(calls, [
    ["disabled", 1_000],
    ["fill", "", 1_000],
    ["wait", 100],
    ["fill", "", 1_000],
    ["fill", "Hydration readiness", 1_000],
    ["enabled", 1_000, false],
    ["wait", 100],
    ["fill", "", 1_000],
    ["fill", "Hydration readiness", 1_000],
    ["enabled", 1_000, true],
    ["fill", "", 1_000],
    ["disabled", 1_000]
  ]);
});

test("generated Sales Task hydration does not retry non-timeout failures", async () => {
  let waits = 0;
  const page = {
    getByRole(role, options) {
      assert.deepEqual([role, options], ["form", { name: "Create task" }]);
      return { getByRole(childRole) {
        if (childRole === "textbox") return { fill: async () => { throw new TypeError("controlled programmer failure"); } };
        return { isDisabled: async () => true };
      } };
    },
    locator: () => ({ innerText: async () => "fixture body" }),
    waitForTimeout: async () => { waits += 1; },
    url: () => "http://fixture.test/sales/tasks"
  };
  await assert.rejects(proveGeneratedSalesTaskRouteHydration(page, () => "fixture process"), /controlled programmer failure/u);
  assert.equal(waits, 0);
});

test("generated Sales Task hydration reserves restoration inside one ten-second deadline", async () => {
  let elapsed = 0;
  let attempt = 0;
  let enabled = false;
  const timeouts = [];
  const advance = (duration) => { elapsed += duration; };
  const page = {
    getByRole() {
      return { getByRole(role) {
        if (role === "textbox") return { fill: async (value, options) => {
          timeouts.push(options.timeout);
          if (attempt === 0) { attempt = 1; advance(1_000); throw new playwrightErrors.TimeoutError("controlled locator timeout"); }
          const duration = attempt === 1 ? 900 : 1_000;
          advance(duration);
          if (attempt === 2) enabled = value !== "";
        } };
        return {
          isDisabled: async (options) => { timeouts.push(options.timeout); advance(1_000); return !enabled; },
          isEnabled: async (options) => {
            timeouts.push(options.timeout);
            advance(attempt === 1 ? 900 : 1_000);
            if (attempt === 1) { attempt = 2; return false; }
            return enabled;
          }
        };
      } };
    },
    locator: () => ({ innerText: async () => "fixture body" }),
    waitForTimeout: async (duration) => { advance(duration); },
    url: () => "http://fixture.test/sales/tasks"
  };
  await proveGeneratedSalesTaskRouteHydration(page, () => "fixture process", () => elapsed);
  assert.equal(elapsed, 9_900);
  assert.equal(timeouts.every((timeout) => timeout > 0 && timeout <= 1_000), true);
});

test("generated Sales Task hydration never passes a zero timeout after deadline exhaustion", async () => {
  let elapsed = 0;
  let fillCalls = 0;
  let disabledCalls = 0;
  const timeouts = [];
  const page = {
    getByRole() {
      return { getByRole(role) {
        if (role === "textbox") return { fill: async (_value, options) => {
          timeouts.push(options.timeout);
          fillCalls += 1;
          if (fillCalls === 3) elapsed += 600;
        } };
        return {
          isDisabled: async (options) => { timeouts.push(options.timeout); disabledCalls += 1; return true; },
          isEnabled: async (options) => { timeouts.push(options.timeout); elapsed = 9_500; return true; }
        };
      } };
    },
    locator: () => ({ innerText: async () => "fixture body" }),
    waitForTimeout: async () => undefined,
    url: () => "http://fixture.test/sales/tasks"
  };
  await assert.rejects(
    proveGeneratedSalesTaskRouteHydration(page, () => "fixture process", () => elapsed),
    /exceeded its ten-second deadline/u
  );
  assert.equal(disabledCalls, 1);
  assert.equal(timeouts.at(-1), 500);
  assert.equal(timeouts.every((timeout) => timeout > 0 && timeout <= 1_000), true);
});

test("generated route projection wait observes an exact bounded denied response", async () => {
  const page = pageFixture({ projectionStatus: 404 });
  const response = await waitForGeneratedRouteProjection(page, "http://fixture.test/sales/tasks", 404);
  assert.equal(response.status(), 404);
  assert.deepEqual(page.calls, [["projection", { timeout: 30_000 }]]);
});

test("generated route navigation rejects non-registered and decorated URLs before navigation", async () => {
  for (const url of [
    "http://fixture.test/",
    "http://fixture.test/sales/unknown",
    "http://fixture.test/sales/tasks?next=/sales",
    "http://fixture.test/sales/tasks#editor",
    "http://operator@fixture.test/sales/tasks"
  ]) {
    const page = pageFixture();
    await assert.rejects(navigateGeneratedRouteToReady(page, url, page.ready, () => "fixture process"));
    assert.deepEqual(page.calls, []);
  }
});

test("generated route navigation rejects redirected and mismatched final URLs before readiness", async () => {
  for (const fixture of [
    pageFixture({ responseUrl: "http://fixture.test/login", pageUrl: "http://fixture.test/login" }),
    pageFixture({ pageUrl: "http://fixture.test/login" })
  ]) {
    await assert.rejects(
      navigateGeneratedRouteToReady(fixture, "http://fixture.test/sales/tasks", fixture.ready, () => "fixture process"),
      /must not redirect|must remain at the requested URL/u
    );
    assert.equal(fixture.calls.some(([kind]) => kind === "ready"), false);
  }
});

test("generated route navigation preserves bounded response and readiness diagnostics", async () => {
  const unavailable = pageFixture({ status: 503 });
  await assert.rejects(
    navigateGeneratedRouteToReady(unavailable, "http://fixture.test/sales/tasks", unavailable.ready, () => "fixture process"),
    /Generated route returned 503[\s\S]*body=fixture body[\s\S]*process=fixture process/u
  );
  const notReady = pageFixture({ readyError: new Error("semantic route missing") });
  await assert.rejects(
    navigateGeneratedRouteToReady(notReady, "http://fixture.test/sales/tasks", notReady.ready, () => "fixture process"),
    /semantic route missing[\s\S]*body=fixture body[\s\S]*process=fixture process/u
  );
});
