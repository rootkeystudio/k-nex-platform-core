import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { chromium } from "playwright";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import { createPayloadRequest } from "payload";
import pg from "pg";
import { startHotApplicationFixedRouteHost } from "./hot-application-fixed-route-host.mjs";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const directory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-gate-1";
const owner = Object.freeze({ kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 });
const readPermissions = ["sales.tasks.read", "sales.tasks.title.read", "sales.tasks.status.read", "sales.tasks.revenue.read"];
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function deferredRead() {
  let reached;
  let release;
  return {
    reached: new Promise((resolve) => { reached = resolve; }),
    release: new Promise((resolve) => { release = resolve; }),
    markReached: () => reached(),
    continue: () => release()
  };
}

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: directory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p10-5-boundaries", BOOT_KEY: "p10-5-boundaries" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function seed(store, userId) {
  const first = await store.transaction({ applicationId, environment: "production", authorizationRevision: 0, lifecycleRevision: 0 }, async (transaction) => {
    await transaction.write({ kind: "extension-generation", generation: { schemaVersion: 1, applicationId, owner, runtimeGenerationIds: ["static-module-sales-1"], state: "current", authorizationRevision: 0, lifecycleRevision: 0 } });
    await transaction.write({ kind: "role", role: { schemaVersion: 1, applicationId, id: "fixture.sales", label: "Fixture Sales", revision: 0 } });
    await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, applicationId, id: "fixture.sales.user", roleId: "fixture.sales", principal: { kind: "user", id: String(userId) }, state: "active", revision: 0 } });
  });
  await store.transaction({ applicationId, environment: "production", authorizationRevision: first.state.authorizationRevision, lifecycleRevision: first.state.lifecycleRevision }, async (transaction) => {
    for (const permissionId of readPermissions) {
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, applicationId, id: `fixture.${permissionId}`, roleId: "fixture.sales", permissionId, owner, revision: 0 } });
    }
  });
}

function hotApplicationFixture() {
  const source = Buffer.from("self.onmessage=() => {};\n");
  const fileDigest = sha256(source);
  const artifactDigest = `sha256:${"a".repeat(64)}`;
  const generationId = "sales-live-generation-1";
  const manifest = Object.freeze({
    deliveryClass: "hot-application",
    id: "app.sales-live",
    entrypoints: { ui: ["ui/main.mjs"] },
    files: { "ui/main.mjs": { digest: fileDigest, bytes: source.byteLength, contentType: "application/javascript" } }
  });
  const staged = Object.freeze({
    artifactDigest,
    catalogDigest: `sha256:${"b".repeat(64)}`,
    verified: Object.freeze({
      artifactDigest,
      manifest,
      hotApplicationManifest: Object.freeze({ screens: [{ id: "sales.screen", route: "/", entrypoint: "ui/main.mjs" }], sources: [{ id: "sales.opportunities" }, { id: "sales.tasks" }], actions: [{ id: "sales.task.create" }] }),
      files: new Map([["ui/main.mjs", source]])
    })
  });
  let artifactReads = 0;
  let artifactBarrier;
  let lifecycleBarrier;
  return Object.freeze({
    store: Object.freeze({
      inventory: async () => {
        const barrier = lifecycleBarrier;
        lifecycleBarrier = undefined;
        if (barrier) { barrier.markReached(); await barrier.release; }
        return Object.freeze({ extensions: { hotApplications: { "app.sales-live": { disposition: "active", activeGeneration: { generationId, artifactDigest }, revision: 1 } } } });
      }
    }),
    artifacts: Object.freeze({ readRemoteUi: async () => {
      artifactReads += 1;
      const barrier = artifactBarrier;
      artifactBarrier = undefined;
      if (barrier) { barrier.markReached(); await barrier.release; }
      return staged;
    } }),
    artifactReads: () => artifactReads,
    deferArtifactRead() { return (artifactBarrier = deferredRead()); },
    deferLifecycleRead() { return (lifecycleBarrier = deferredRead()); },
    extension: Object.freeze({ id: "app.sales-live" })
  });
}

test("P10.5 current authority denies fixture source/action before handler, cache, and Payload", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(image).withDatabase("boundaries").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let payload;
  try {
    await boot(container.getConnectionUri());
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.PAYLOAD_SECRET = "p10-5-boundaries";
    const { bootGate1Application } = await import("../dist/src/boot.js");
    payload = await bootGate1Application({ key: "p10-5-boundaries" });
    const password = "p10-5-boundaries-password";
    const user = await payload.create({ collection: "users", data: { email: "p10-5@example.test", password } });
    const otherUser = await payload.create({ collection: "users", data: { email: "p10-5-other@example.test", password } });
    await payload.create({ collection: "sales-tasks", data: { title: "P10.5 task", status: "open", potentialRevenue: "1" } });
    const login = await payload.login({ collection: "users", data: { email: "p10-5@example.test", password }, overrideAccess: false });
    const otherLogin = await payload.login({ collection: "users", data: { email: "p10-5-other@example.test", password }, overrideAccess: false });
    assert.ok(login.token && otherLogin.token);
    assert.notEqual(String(user.id), String(otherUser.id));
    const source = payload.config.endpoints.find(({ path }) => path === "/k-nex/data-source-query");
    const action = payload.config.endpoints.find(({ path }) => path === "/k-nex/action");
    assert.ok(source && action);
    const originalFind = payload.find.bind(payload);
    const originalCreate = payload.create.bind(payload);
    let finds = 0;
    let creates = 0;
    payload.find = async (...input) => { finds += 1; return originalFind(...input); };
    payload.create = async (...input) => { creates += 1; return originalCreate(...input); };
    const request = (path, body, token = login.token) => createPayloadRequest({
      config: payload.config,
      payloadInstanceCacheKey: "p10-5-boundaries",
      request: new Request(`http://localhost/api${path}`, { method: "POST", headers: { authorization: `JWT ${token}`, "content-type": "application/json", "idempotency-key": "p10-5-proof" }, body: JSON.stringify(body) })
    });
    const sourceBody = { sourceId: "sales.tasks", surface: "workspace", input: {}, query: { page: { number: 1, size: 25 }, filters: [], sort: [] }, selectedFields: ["title", "status", "potential-revenue"] };
    assert.equal((await source.handler(await request("/k-nex/data-source-query", sourceBody))).status, 403);
    assert.equal(finds, 0, "denied source must not enter handler/cache/Payload");
    const deniedActionRequest = await request("/k-nex/action", { actionId: "sales.task.create", input: { title: "blocked", status: "open" } });
    assert.equal((await action.handler(deniedActionRequest)).status, 403);
    assert.equal(creates, 0, "denied action must not enter handler/Payload");

    const { composedApplication } = await import("../dist/src/payload.config.js");
    const authorityContext = composedApplication.authority.context(deniedActionRequest, "p10-5-boundary-proof");
    const route = composedApplication.registration.contributions.routes[0]?.value;
    const page = composedApplication.registration.contributions.pageTemplates[0]?.value;
    const navigation = composedApplication.registration.contributions.navigation[0]?.value;
    assert.ok(route && page && navigation);
    let routeEntries = 0;
    let pageRenders = 0;
    await assert.rejects(composedApplication.authority.permissions.enterRoute(authorityContext, route, () => { routeEntries += 1; }));
    await assert.rejects(composedApplication.authority.permissions.renderPage(authorityContext, page, () => { pageRenders += 1; }));
    assert.deepEqual(await composedApplication.authority.permissions.visibleNavigation(authorityContext, [navigation]), []);
    assert.deepEqual([routeEntries, pageRenders], [0, 0], "denied route/page must not enter or render");

    const actor = { principal: { kind: "user", id: String(user.id) }, effectiveActor: { kind: "user", id: String(user.id) } };
    const listed = await composedApplication.toolCatalog.list({ actor, delegation: {}, authorizationContext: authorityContext, surface: "workspace", features: [] });
    assert.equal(listed.tools.length, 0, "denied tools must not enter the MCP-visible catalog");
    let topicAuthorizations = 0;
    const topicId = composedApplication.registration.contributions.realtimeTopics[0]?.id;
    assert.ok(topicId);
    const subscription = { actor: { id: String(user.id), type: "user" }, deadlineAt: Date.now() + 1_000, params: {}, signal: new AbortController().signal };
    assert.equal(await composedApplication.authority.authorizeRealtime(authorityContext, {
      id: topicId,
      authorize: async () => { topicAuthorizations += 1; return true; },
      parseEvent: (value) => value,
      parseParams: () => ({})
    }, subscription), false);
    assert.equal(topicAuthorizations, 0, "denied realtime must not enter topic authorization");

    const remote = hotApplicationFixture();
    const otherAuthorityRequest = await request("/k-nex/action", { actionId: "sales.task.create", input: { title: "other", status: "open" } }, otherLogin.token);
    const otherAuthorityContext = composedApplication.authority.context(otherAuthorityRequest, "p10-5-other-boundary-proof", otherAuthorityRequest.user);
    const remoteUserA = Object.freeze({ sessionId: "remote-user-a", ...composedApplication.authority.remoteUi(authorityContext) });
    const remoteUserB = Object.freeze({ sessionId: "remote-user-b", ...composedApplication.authority.remoteUi(otherAuthorityContext) });
    const remoteSessions = new Map([
      ["remote-user-a", remoteUserA],
      ["remote-user-b", remoteUserB]
    ]);
    const authorizationStore = new PostgresAuthorizationStore(pool, {
      validate: (currentApplicationId, subject) => currentApplicationId === applicationId && subject.kind === "user" && subject.id === String(user.id) ? "accepted" : "rejected"
    });
    let sourceDispatches = 0;
    const remoteHost = await startHotApplicationFixedRouteHost({
      ...remote,
      applicationId,
      environment: "production",
      authorization: {
        current(request) {
          const opaqueSession = /(?:^|;\s*)customer_session=([^;]+)/u.exec(request.headers.cookie ?? "")?.[1];
          return opaqueSession ? remoteSessions.get(opaqueSession) : undefined;
        }
      },
      invokeSource: async () => { sourceDispatches += 1; return { unreachable: true }; }
    });
    let browser;
    let browserContext;
    try {
      browser = await chromium.launch();
      browserContext = await browser.newContext({ ignoreHTTPSErrors: true });
      const deniedRoute = await browserContext.newPage();
      const deniedResponse = await deniedRoute.goto(`${remoteHost.url}/apps/sales-live`);
      assert.equal(deniedResponse?.status(), 401, "an anonymous browser must stop before route authorization");
      assert.equal((await deniedRoute.content()).includes("hot-application-route"), false);
      assert.equal(remoteHost.routeRequests.length, 0, "denied route must not create a route session");
      assert.equal(remote.artifactReads(), 0, "anonymous route must not read verified bytes");

      await seed(authorizationStore, user.id);
      const sourceAllowed = await source.handler(await request("/k-nex/data-source-query", sourceBody));
      assert.equal(sourceAllowed.status, 200);
      assert.ok(finds > 0);

      await browserContext.addCookies([{ name: "customer_session", value: "remote-user-b", url: remoteHost.url, httpOnly: true, secure: true, sameSite: "Lax" }]);
      const otherDeniedRoute = await browserContext.newPage();
      const otherDeniedResponse = await otherDeniedRoute.goto(`${remoteHost.url}/apps/sales-live`);
      assert.equal(otherDeniedResponse?.status(), 403, "an ungranted browser session must not inherit another actor's authority");
      assert.equal((await otherDeniedRoute.content()).includes("hot-application-route"), false);
      assert.equal(remoteHost.routeRequests.length, 0);
      assert.equal(remote.artifactReads(), 0, "actor B denial must happen before actor A's artifact access");

      await browserContext.clearCookies();
      await browserContext.addCookies([{ name: "customer_session", value: "remote-user-a", url: remoteHost.url, httpOnly: true, secure: true, sameSite: "Lax" }]);
      const grantedRoute = await browserContext.newPage();
      await grantedRoute.addInitScript(() => { window.setInterval = () => 0; });
      const grantedResponse = await grantedRoute.goto(`${remoteHost.url}/apps/sales-live`);
      assert.equal(grantedResponse?.status(), 200);
      const route = await grantedRoute.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE__);
      assert.ok(route);

      const sourceStatus = await grantedRoute.evaluate(async (configuration) => {
        const response = await fetch(configuration.sourceUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: configuration.sessionId, identity: configuration, targetId: "sales.opportunities", input: {} })
        });
        return response.status;
      }, route);
      assert.equal(sourceStatus, 401, "current RBAC must deny an ungranted declared Remote UI source");
      const actionStatus = await grantedRoute.evaluate(async (configuration) => {
        const query = new URLSearchParams({ operation: "action", targetId: "sales.task.create", sessionId: configuration.sessionId });
        return (await fetch(`/api/extensions/remote-ui/authorize-target?${query}`, { method: "POST" })).status;
      }, route);
      assert.equal(actionStatus, 401, "current RBAC must deny an ungranted declared Remote UI action");
      assert.equal(sourceDispatches, 0, "target denial must happen before source dispatch");
      assert.equal(remoteHost.sourceRequests.length, 0, "denied target must not enter source lifecycle");
      const lifecycleRace = remote.deferLifecycleRead();
      const racedSource = grantedRoute.evaluate(async (configuration) => {
        const response = await fetch(configuration.sourceUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: configuration.sessionId, identity: configuration, targetId: "sales.tasks", input: {} })
        });
        return response.status;
      }, route);
      await lifecycleRace.reached;
      remoteSessions.set("remote-user-a", remoteUserB);
      lifecycleRace.continue();
      assert.equal(await racedSource, 401, "actor switch during lifecycle read must fail the continuation recheck");
      assert.equal(sourceDispatches, 0);
      assert.equal(remoteHost.sourceRequests.length, 0);
      remoteSessions.set("remote-user-a", remoteUserA);
      await grantedRoute.close();

      const artifactRace = remote.deferArtifactRead();
      const racedRoute = await browserContext.newPage();
      const racedNavigation = racedRoute.goto(`${remoteHost.url}/apps/sales-live`);
      await artifactRace.reached;
      remoteSessions.set("remote-user-a", remoteUserB);
      artifactRace.continue();
      const racedResponse = await racedNavigation;
      assert.equal(racedResponse?.status(), 403, "actor switch during artifact read must fail the continuation recheck");
      assert.equal((await racedRoute.content()).includes("hot-application-route"), false);
      assert.equal(remoteHost.routeRequests.length, 1, "raced route must not create another route session");
      remoteSessions.set("remote-user-a", remoteUserA);
    } finally {
      await browserContext?.close();
      await browser?.close();
      await remoteHost.close();
    }
  } finally {
    await payload?.destroy();
    await pool.end();
    payload?.db?.pool?.on?.("error", () => undefined);
    await container.stop();
  }
});
