import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import test from "node:test";

import { startHotApplicationFixedRouteHost } from "./hot-application-fixed-route-host.mjs";

const applicationId = "customer-gate-1";
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function hotApplicationFixture() {
  const source = Buffer.from("self.onmessage=() => {};\n");
  const artifactDigest = `sha256:${"a".repeat(64)}`;
  const generationId = "sales-live-generation-1";
  const manifest = Object.freeze({ deliveryClass: "hot-application", id: "app.sales-live", entrypoints: { ui: ["ui/main.mjs"] }, files: { "ui/main.mjs": { digest: sha256(source), bytes: source.byteLength, contentType: "application/javascript" } } });
  const staged = Object.freeze({ artifactDigest, catalogDigest: `sha256:${"b".repeat(64)}`, verified: Object.freeze({ artifactDigest, manifest, hotApplicationManifest: Object.freeze({ screens: [{ id: "sales.screen", route: "/", entrypoint: "ui/main.mjs" }], sources: [{ id: "sales.source" }], actions: [] }), files: new Map([["ui/main.mjs", source]]) }) });
  return Object.freeze({
    store: Object.freeze({ inventory: async () => Object.freeze({ extensions: { hotApplications: { "app.sales-live": { disposition: "active", activeGeneration: { generationId, artifactDigest }, revision: 1 } } } }) }),
    artifacts: Object.freeze({ readRemoteUi: async () => staged }),
    extension: Object.freeze({ id: "app.sales-live" })
  });
}

function request(host, path, { method = "GET", body = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const client = httpsRequest(`${host.url}${path}`, { method, ca: host.tlsCertificate, headers: { cookie: "customer_session=remote-user-a", ...(body === undefined ? {} : { "content-type": "application/json" }) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    client.once("error", reject);
    client.end(body);
  });
}

function routeConfiguration(response) {
  const match = /window\.__K_NEX_HOT_APPLICATION_ROUTE__=(.*?)<\/script>/su.exec(response.body);
  assert.ok(match);
  return JSON.parse(match[1]);
}

test("P10.8 fixed route binds emitted authorization admission to current authority", async () => {
  const fixture = hotApplicationFixture();
  const admissions = [];
  let revisionReads = 0;
  let sessionPresent = true;
  let allowed = true;
  const host = await startHotApplicationFixedRouteHost({
    ...fixture,
    applicationId,
    environment: "production",
    authorization: {
      revision: async () => { revisionReads += 1; return admissions.shift(); },
      current: () => sessionPresent ? Object.freeze({ sessionId: "remote-user-a", authorizeRoute: async () => allowed, authorizeFrame: async () => allowed, authorizeTarget: async () => allowed }) : undefined
    },
    invokeSource: async () => ({})
  });
  try {
    admissions.push({ authorizationRevision: 0, authorizationProof: "route-before" }, { authorizationRevision: 1, authorizationProof: "route-after" });
    assert.equal((await request(host, "/apps/sales-live")).status, 503, "changed authorization admission must fail closed after route authorization");
    assert.equal(host.routeRequests.length, 0, "a mismatched admission must not create a route session");

    admissions.push({ authorizationRevision: 1, authorizationProof: "route-stable" }, { authorizationRevision: 1, authorizationProof: "route-stable" }, { authorizationRevision: 1, authorizationProof: "route-stable" });
    const route = await request(host, "/apps/sales-live");
    assert.equal(route.status, 200);
    assert.equal(host.routeRequests.length, 1);
    const configuration = routeConfiguration(route);

    admissions.push({ authorizationRevision: 1, authorizationProof: "route-stable" }, { authorizationRevision: 1, authorizationProof: "route-stable" });
    assert.equal((await request(host, configuration.snapshotUrl)).status, 200, "a route session may only observe its exact admission");

    allowed = false;
    admissions.push({ authorizationRevision: 1, authorizationProof: "route-stable" });
    const deniedSnapshot = await request(host, configuration.snapshotUrl);
    assert.equal(deniedSnapshot.status, 401);
    assert.equal(deniedSnapshot.headers["x-k-nex-authorization-revision"], "1");
    assert.equal(deniedSnapshot.headers["x-k-nex-authorization-proof"], "route-stable");

    sessionPresent = false;
    const revisionReadsBeforeAnonymousRequest = revisionReads;
    const anonymousSnapshot = await request(host, configuration.snapshotUrl);
    assert.equal(anonymousSnapshot.status, 401);
    assert.equal(anonymousSnapshot.headers["x-k-nex-authorization-revision"], undefined);
    assert.equal(revisionReads, revisionReadsBeforeAnonymousRequest, "anonymous snapshots must not require an authorization-state read before returning 401");

    const deniedRoute = await request(host, "/apps/sales-live");
    assert.equal(deniedRoute.status, 401);
    assert.equal(deniedRoute.headers["x-k-nex-authorization-revision"], undefined);
    assert.equal(revisionReads, revisionReadsBeforeAnonymousRequest, "anonymous routes must not require an authorization-state read before returning 401");

    sessionPresent = true;
    allowed = true;
    assert.equal((await request(host, "/apps/sales-live")).status, 503, "an authenticated route without a shape-valid authorization admission must fail closed");
  } finally {
    await host.close();
  }
});

test("P10.8 fixed route sessions cannot replay after revocation and regrant", async () => {
  const fixture = hotApplicationFixture();
  let authorizationRevision = 1;
  let authorizationProof = "admission-1";
  let allowed = true;
  let sourceCalls = 0;
  let frameAuthorizationCalls = 0;
  let targetAuthorizationCalls = 0;
  let reviseOnFrameAuthorizationCall = 0;
  let reviseOnTargetAuthorizationCall = 0;
  const host = await startHotApplicationFixedRouteHost({
    ...fixture,
    applicationId,
    environment: "production",
    authorization: {
      revision: () => ({ authorizationRevision, authorizationProof }),
      current: () => Object.freeze({
        sessionId: "remote-user-a",
        authorizeRoute: async () => allowed,
        authorizeFrame: async () => {
          frameAuthorizationCalls += 1;
          if (frameAuthorizationCalls === reviseOnFrameAuthorizationCall) {
            reviseOnFrameAuthorizationCall = 0;
            authorizationRevision += 1;
            authorizationProof = `admission-${authorizationRevision}`;
          }
          return allowed;
        },
        authorizeTarget: async () => {
          targetAuthorizationCalls += 1;
          if (targetAuthorizationCalls === reviseOnTargetAuthorizationCall) {
            reviseOnTargetAuthorizationCall = 0;
            authorizationRevision += 1;
            authorizationProof = `admission-${authorizationRevision}`;
          }
          return allowed;
        }
      })
    },
    invokeSource: async () => { sourceCalls += 1; return {}; }
  });
  const freshRoute = async () => {
    const response = await request(host, "/apps/sales-live");
    assert.equal(response.status, 200);
    return routeConfiguration(response);
  };
  const regrant = (revision) => {
    allowed = false;
    allowed = true;
    authorizationRevision = revision;
    authorizationProof = `admission-${revision}`;
  };
  try {
    const first = await freshRoute();
    regrant(2);
    const staleSnapshot = await request(host, first.snapshotUrl);
    assert.equal(staleSnapshot.status, 401, "a regrant must not revive an old route session");
    assert.equal(staleSnapshot.headers["x-k-nex-authorization-revision"], "2");
    assert.equal(staleSnapshot.headers["x-k-nex-authorization-proof"], "admission-2");
    assert.equal((await request(host, first.snapshotUrl)).headers["x-k-nex-authorization-revision"], undefined, "a mismatched session is deleted after snapshot denial");

    const second = await freshRoute();
    assert.notEqual(second.sessionId, first.sessionId, "only a fresh route admission may create a replacement session");
    regrant(3);
    assert.equal((await request(host, `/api/extensions/remote-ui/authorize?sessionId=${second.sessionId}`, { method: "POST" })).status, 401, "frame authorization rejects a stale admission");

    const third = await freshRoute();
    regrant(4);
    assert.equal((await request(host, `/api/extensions/remote-ui/authorize-target?sessionId=${third.sessionId}&operation=source&targetId=sales.source`, { method: "POST" })).status, 401, "target authorization rejects a stale admission");

    const fourth = await freshRoute();
    regrant(5);
    assert.equal((await request(host, "/api/extensions/remote-ui/source", {
      method: "POST",
      body: JSON.stringify({ sessionId: fourth.sessionId, identity: { applicationId, environment: "production", appId: fourth.appId, generationId: fourth.generationId, artifactDigest: fourth.artifactDigest, sessionId: fourth.sessionId }, targetId: "sales.source", input: null })
    })).status, 401, "source admission rejects a stale session before invoking the app");
    assert.equal(sourceCalls, 0);

    const fifth = await freshRoute();
    assert.notEqual(fifth.sessionId, fourth.sessionId);
    reviseOnFrameAuthorizationCall = frameAuthorizationCalls + 1;
    assert.equal((await request(host, `/api/extensions/remote-ui/authorize?sessionId=${fifth.sessionId}`, { method: "POST" })).status, 401, "frame authorization rechecks admission after its awaited authority call");

    const sixth = await freshRoute();
    reviseOnTargetAuthorizationCall = targetAuthorizationCalls + 1;
    assert.equal((await request(host, `/api/extensions/remote-ui/authorize-target?sessionId=${sixth.sessionId}&operation=source&targetId=sales.source`, { method: "POST" })).status, 401, "target authorization rechecks admission after its awaited authority call");

    const seventh = await freshRoute();
    reviseOnFrameAuthorizationCall = frameAuthorizationCalls + 2;
    const snapshotRace = await request(host, seventh.snapshotUrl);
    assert.equal(snapshotRace.status, 401, "snapshot rechecks admission after its final frame authorization");
    assert.equal(snapshotRace.headers["x-k-nex-authorization-revision"], String(authorizationRevision));
    assert.equal(snapshotRace.headers["x-k-nex-authorization-proof"], authorizationProof);

    const eighth = await freshRoute();
    reviseOnTargetAuthorizationCall = targetAuthorizationCalls + 2;
    assert.equal((await request(host, "/api/extensions/remote-ui/source", {
      method: "POST",
      body: JSON.stringify({ sessionId: eighth.sessionId, identity: { applicationId, environment: "production", appId: eighth.appId, generationId: eighth.generationId, artifactDigest: eighth.artifactDigest, sessionId: eighth.sessionId }, targetId: "sales.source", input: null })
    })).status, 401, "source rechecks admission after its final target authorization");
    assert.equal(sourceCalls, 0);
  } finally {
    await host.close();
  }
});
