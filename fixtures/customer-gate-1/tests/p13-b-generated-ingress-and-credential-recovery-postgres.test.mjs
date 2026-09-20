import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import pg from "pg";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

const applicationId = "p13-crm-browser";
const environmentName = "test";

async function login(origin, email, password) {
  const response = await fetch(`${origin}/api/users/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json().catch(() => undefined);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  return { status: response.status, cookie, userId: body?.user?.id === undefined ? undefined : String(body.user.id) };
}

async function currentUser(origin, cookie) {
  const response = await fetch(`${origin}/api/users/me`, { headers: { cookie } });
  const body = await response.json().catch(() => undefined);
  return body?.user?.id === undefined ? undefined : String(body.user.id);
}

async function unusedPort() {
  const server = createServer();
  await new Promise((settle, reject) => server.once("error", reject).listen(0, "127.0.0.1", settle));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((settle, reject) => server.close((error) => error ? reject(error) : settle()));
  return address.port;
}

async function eventually(check, failure, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value !== undefined) return value; }
    catch (error) { last = error; }
    await new Promise((settle) => setTimeout(settle, 100));
  }
  throw last ?? new Error(failure);
}

/**
 * Drives one ingress request over a raw socket so the body can be withheld,
 * trickled, or oversized in ways fetch cannot express, and records how the
 * server ended it. A reset counts: the requirement is that the worker stops
 * being held, not that every refusal is delivered as JSON.
 */
function rawIngress(origin, path, { headers = {}, body, deadlineMs = 60_000 }) {
  const url = new URL(path, origin);
  assert.equal(url.protocol, "http:");
  const startedAt = Date.now();
  return new Promise((settle) => {
    let done = false;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearTimeout(expiry);
      try { pending.destroy(); } catch { /* the socket may already be gone */ }
      settle({ ...outcome, elapsedMs: Date.now() - startedAt });
    };
    const pending = httpRequest(url, { method: "POST", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        finish({ kind: "response", status: response.statusCode, body: parsed });
      });
      response.on("error", () => finish({ kind: "response-error", status: response.statusCode }));
    });
    const expiry = setTimeout(() => finish({ kind: "expired" }), deadlineMs);
    pending.on("error", () => finish({ kind: "closed" }));
    // A normal response settles first; this only catches a reset with no reply.
    pending.on("close", () => setImmediate(() => finish({ kind: "closed" })));
    body(pending, () => done);
  });
}

function operatorProbe(application, environment, args, extraEnvironment = {}) {
  return spawnSync("pnpm", args, { cwd: application, env: { ...environment, ...extraEnvironment }, encoding: "utf8" });
}

function inProcessProbe(application, environment, script, extraEnvironment = {}) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: application, env: { ...environment, ...extraEnvironment }, encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const line = result.stdout.split("\n").find((candidate) => candidate.startsWith("PROBE_"));
  assert.ok(line !== undefined, `${result.stdout}\n${result.stderr}`);
  return line.startsWith("PROBE_OK ") ? { ok: true, value: JSON.parse(line.slice("PROBE_OK ".length)) } : { ok: false, code: line.slice("PROBE_ERR ".length) };
}

/**
 * Runs a probe alongside the test instead of ahead of it, so two credential
 * journeys can be in flight at once and the test decides when each one moves.
 */
function startProbe(application, environment, script, extraEnvironment = {}) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: application, env: { ...environment, ...extraEnvironment }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((settle) => child.on("close", (code) => settle(code)));
  return {
    output: () => stdout,
    async result() {
      const code = await exited;
      assert.equal(code, 0, `${stdout}\n${stderr}`);
      // The hold marker is a PROBE_ line too, so only the outcome counts here.
      const line = stdout.split("\n").find((candidate) => candidate.startsWith("PROBE_OK ") || candidate.startsWith("PROBE_ERR "));
      assert.ok(line !== undefined, `${stdout}\n${stderr}`);
      return line.startsWith("PROBE_OK ") ? { ok: true, value: JSON.parse(line.slice("PROBE_OK ".length)) } : { ok: false, code: line.slice("PROBE_ERR ".length) };
    }
  };
}

/**
 * Holds one credential journey at a named point until the test releases it, so
 * a second journey can be proved to be waiting on the first rather than merely
 * observed to have lost a race. Nothing generated is instrumented: both holds
 * wrap the Payload surface the journey already uses, one before it can take the
 * credential lock and one after it has.
 */
const credentialRaceScript = `
import { existsSync } from "node:fs";
import { bootKnexApplication } from "./dist/boot.js";
import { changeCurrentUserCredentials, kNexRequestContext, shutdownKnexApplication } from "./dist/k-nex-authority.js";
const payload = await bootKnexApplication("credential-change");
const holdAt = process.env.PROBE_HOLD_AT;
const release = process.env.PROBE_RELEASE_FILE;
const hold = async (at) => {
  if (holdAt !== at || release === undefined) return;
  console.log("PROBE_HELD " + at);
  const deadline = Date.now() + 180_000;
  while (!existsSync(release) && Date.now() < deadline) await new Promise((settle) => setTimeout(settle, 50));
};
const begin = payload.db.beginTransaction.bind(payload.db);
payload.db.beginTransaction = async (...args) => { await hold("transaction-begin"); return begin(...args); };
const update = payload.update.bind(payload);
payload.update = async (args) => { await hold("credential-write"); return update(args); };
try {
  const headers = new Headers({ cookie: process.env.PROBE_COOKIE });
  const result = await changeCurrentUserCredentials(payload, kNexRequestContext(headers, "credential-change"), JSON.parse(process.env.PROBE_INPUT));
  console.log("PROBE_OK " + JSON.stringify(result));
} catch (error) { console.log("PROBE_ERR " + (error?.code ?? error?.message ?? String(error))); }
finally { await shutdownKnexApplication(payload); }
process.exit(0);
`;

const credentialChangeScript = `
import { bootKnexApplication } from "./dist/boot.js";
import { changeCurrentUserCredentials, kNexRequestContext, shutdownKnexApplication } from "./dist/k-nex-authority.js";
const payload = await bootKnexApplication("credential-change");
try {
  const headers = new Headers(process.env.PROBE_COOKIE === undefined ? {} : { cookie: process.env.PROBE_COOKIE });
  const result = await changeCurrentUserCredentials(payload, kNexRequestContext(headers, "credential-change"), JSON.parse(process.env.PROBE_INPUT));
  console.log("PROBE_OK " + JSON.stringify(result));
} catch (error) { console.log("PROBE_ERR " + (error?.code ?? error?.message ?? String(error))); }
finally { await shutdownKnexApplication(payload); }
process.exit(0);
`;

/**
 * Runs the generated step-up reauthentication the settings and theme journeys
 * call, as many times as it is asked to, so what it leaves behind can be
 * counted rather than argued about.
 */
const reauthenticationScript = `
import { bootKnexApplication } from "./dist/boot.js";
import { kNexRequestContext, reauthenticateCurrentUser, shutdownKnexApplication } from "./dist/k-nex-authority.js";
const payload = await bootKnexApplication("reauthentication");
try {
  const outcomes = [];
  for (const password of JSON.parse(process.env.PROBE_PASSWORDS)) {
    const headers = new Headers({ cookie: process.env.PROBE_COOKIE });
    outcomes.push(await reauthenticateCurrentUser(payload, kNexRequestContext(headers, "reauthentication"), password));
  }
  console.log("PROBE_OK " + JSON.stringify(outcomes));
} catch (error) { console.log("PROBE_ERR " + (error?.code ?? error?.message ?? String(error))); }
finally { await shutdownKnexApplication(payload); }
process.exit(0);
`;

/**
 * Kills the process at one named boundary of the credential journey, so the
 * database is the only thing left to decide what happened. No generated code is
 * instrumented: everything here wraps the Payload surface the journey uses, and
 * "credential-written" reaches the transaction Payload is carrying to move the
 * credential column on it before the session rows are ever cleared.
 */
const credentialBoundaryInstrumentation = `
import { sql } from "@payloadcms/db-postgres";
const boundary = process.env.PROBE_BOUNDARY;
const die = (at) => { if (boundary === at) { console.log("PROBE_DIED " + at); process.exit(86); } };
function instrument(payload) {
  const update = payload.update.bind(payload);
  const commit = payload.db.commitTransaction.bind(payload.db);
  // The credential write is the journey's only payload.update, so it is what
  // arms the commit boundaries: the password proof reaches the database through
  // Payload's own login, which never takes this path.
  let writing = false;
  payload.update = async (args) => {
    writing = true;
    die("before-write");
    if (boundary === "credential-written") {
      const session = payload.db.sessions[String(await args.req.transactionID)];
      if (session === undefined) throw new Error("the credential write is not carrying a transaction");
      await session.db.execute(sql\`update users set email='boundary-orphan@p13.example.test' where id=\${args.id}\`);
      die("credential-written");
    }
    const result = await update(args);
    die("after-write");
    return result;
  };
  payload.db.commitTransaction = async (id) => {
    if (writing) die("after-audit");
    const value = await commit(id);
    if (writing) die("after-commit");
    return value;
  };
}
`;

const credentialBoundaryScript = `${credentialBoundaryInstrumentation}
import { bootKnexApplication } from "./dist/boot.js";
import { changeCurrentUserCredentials, kNexRequestContext, shutdownKnexApplication } from "./dist/k-nex-authority.js";
const payload = await bootKnexApplication("credential-change");
instrument(payload);
try {
  const headers = new Headers({ cookie: process.env.PROBE_COOKIE });
  const result = await changeCurrentUserCredentials(payload, kNexRequestContext(headers, "credential-change"), JSON.parse(process.env.PROBE_INPUT));
  console.log("PROBE_OK " + JSON.stringify(result));
} catch (error) { console.log("PROBE_ERR " + (error?.code ?? error?.message ?? String(error))); }
finally { await shutdownKnexApplication(payload); }
process.exit(0);
`;

const recoveryBoundaryScript = `${credentialBoundaryInstrumentation}
import { bootKnexApplication } from "./dist/boot.js";
import { acquireBootstrapLock, assertIssuedBootstrapToken, readCredentialRecoveryToken, releaseBootstrapLock } from "./dist/k-nex-bootstrap-token.js";
import { kNexAuthority, recoverProtectedOwnerCredential, shutdownKnexApplication } from "./dist/k-nex-authority.js";
import { kNexIdentity } from "./dist/k-nex-identity.js";
const payload = await bootKnexApplication("owner-credential-recovery");
instrument(payload);
let lock;
try {
  const token = readCredentialRecoveryToken(["--token-file", process.env.PROBE_TOKEN_FILE]);
  lock = await acquireBootstrapLock(payload);
  await assertIssuedBootstrapToken(lock, token);
  const receipt = await kNexAuthority(payload).store.readProtectedRoleBaselineReceipt(kNexIdentity.applicationId);
  const recovered = await recoverProtectedOwnerCredential(payload, receipt, process.env.PROBE_OPERATOR, token, { email: process.env.PROBE_EMAIL, password: process.env.PROBE_PASSWORD });
  console.log("PROBE_OK " + JSON.stringify(recovered));
} catch (error) { console.log("PROBE_ERR " + (error?.code ?? error?.message ?? String(error))); }
finally {
  try { if (lock !== undefined) await releaseBootstrapLock(lock); }
  finally { await shutdownKnexApplication(payload); }
}
process.exit(0);
`;

/** The journey is expected to die here, so a clean exit is the failure. */
function boundaryProbe(application, environment, script, boundary, extraEnvironment) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: application, env: { ...environment, ...extraEnvironment, PROBE_BOUNDARY: boundary }, encoding: "utf8"
  });
  assert.equal(result.status, 86, `A ${boundary} probe must die at its boundary.\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(`PROBE_DIED ${boundary}`, "u"), `${result.stdout}\n${result.stderr}`);
}

test("P13.B generated ingress readers are bounded, the realtime bridge recovers, and owner credentials are recoverable", { timeout: 1_200_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ application, origin, personas, pool, environment, applicationOutput }) => {
    const owner = await login(origin, personas.owner.email, personas.owner.password);
    assert.equal(owner.status, 200);
    assert.ok(owner.cookie);
    const uploadHeaders = { cookie: owner.cookie, origin, "content-type": "application/json" };

    // -------- bounded ingress --------
    const oversizedNoLength = await rawIngress(origin, "/api/k-nex/sales/import-upload", {
      headers: uploadHeaders,
      body: (pending) => {
        pending.write('{"artifactId":"p13b-oversized-stream","bytesBase64":"');
        for (let index = 0; index < 23; index += 1) pending.write("A".repeat(1_000_000));
        pending.end('","contentType":"text/csv"}');
      }
    });
    assert.deepEqual({ kind: oversizedNoLength.kind, status: oversizedNoLength.status, body: oversizedNoLength.body },
      { kind: "response", status: 400, body: { code: "IMPORT_LIMIT_EXCEEDED" } },
      `An oversized chunked upload with no content-length must be refused: ${JSON.stringify(oversizedNoLength)}`);
    assert.equal((await pool.query("select count(*)::int count from sales_import_uploads where artifact_id='p13b-oversized-stream'")).rows[0].count, 0);

    const declaredOversize = await rawIngress(origin, "/api/k-nex/sales/import-upload", {
      headers: { ...uploadHeaders, "content-length": "22369921" },
      body: (pending) => { pending.write("{"); }
    });
    assert.deepEqual({ kind: declaredOversize.kind, status: declaredOversize.status, body: declaredOversize.body },
      { kind: "response", status: 400, body: { code: "IMPORT_LIMIT_EXCEEDED" } });
    assert.ok(declaredOversize.elapsedMs < 5_000, `A declared oversize length must be refused without reading: ${declaredOversize.elapsedMs}ms`);

    const neverEnding = await rawIngress(origin, "/api/k-nex/sales/import-upload", {
      headers: uploadHeaders,
      body: (pending) => { pending.write('{"artifactId":"p13b-never-ending"'); },
      deadlineMs: 20_000
    });
    assert.notEqual(neverEnding.kind, "expired", "A body that never ends must not hold the generated upload route open.");
    assert.ok(neverEnding.elapsedMs < 15_000, `A body that never ends must be released quickly: ${neverEnding.elapsedMs}ms`);

    const trickled = await rawIngress(origin, "/api/k-nex/sales/import-upload", {
      headers: uploadHeaders,
      body: (pending, cancelled) => {
        pending.write('{"artifactId":"p13b-trickle"');
        const timer = setInterval(() => {
          if (cancelled() || pending.destroyed) { clearInterval(timer); return; }
          try { pending.write(" "); } catch { clearInterval(timer); }
        }, 100);
      },
      deadlineMs: 90_000
    });
    assert.notEqual(trickled.kind, "expired", "A one-byte-per-interval upload must not hold the generated route past its deadline.");
    assert.ok(trickled.elapsedMs < 45_000, `A trickled upload must end on the total deadline: ${trickled.elapsedMs}ms`);

    const webhookNeverEnding = await rawIngress(origin, "/api/k-nex/sales/providers/email-reference/webhook", {
      headers: { "content-type": "application/json", "x-k-nex-signature": "sha256=" + "0".repeat(64), "x-k-nex-timestamp": new Date().toISOString() },
      body: (pending) => { pending.write("{"); },
      deadlineMs: 20_000
    });
    assert.notEqual(webhookNeverEnding.kind, "expired", "An unauthenticated webhook body that never ends must not hold a worker.");
    assert.ok(webhookNeverEnding.elapsedMs < 15_000, `An unauthenticated webhook body must be released quickly: ${webhookNeverEnding.elapsedMs}ms`);

    const healthStartedAt = Date.now();
    assert.equal((await fetch(`${origin}/api/health`)).ok, true, `Generated host must stay healthy after bounded ingress refusals.\n${applicationOutput()}`);
    assert.ok(Date.now() - healthStartedAt < 5_000, "Generated host must still answer promptly after bounded ingress refusals.");

    // -------- no GraphQL credential surface --------
    // Payload publishes login, refresh, forgot-password and reset-password as
    // GraphQL mutations for every auth collection, and its resolvers call the
    // same operations the REST endpoints do. A GraphQL route therefore reached
    // every credential operation without passing the credential authority or
    // the REST refusals, and policing it by operation name would fail open on
    // aliases, variables, fragments and batching. The route is not generated at
    // all, so there is nothing to police.
    const ownerSessionCount = async (userId) => (await pool.query("select count(*)::int count from users_sessions where _parent_id=$1", [userId])).rows[0].count;
    const sessionsBeforeGraphql = await ownerSessionCount(owner.userId);
    const graphqlAttempts = [
      // Named, aliased, variable-driven, fragment-carrying and batched forms of
      // the same auth mutations, none of which an operation-name filter catches.
      { query: "mutation { loginUser(email: \"a@b.test\", password: \"x\") { token } }" },
      { query: "mutation Anything($e: String!, $p: String!) { session: loginUser(email: $e, password: $p) { token user { ...Who } } } fragment Who on User { id email }", variables: { e: personas.owner.email, p: personas.owner.password } },
      { query: "mutation { refreshTokenUser { token } }" },
      { query: "mutation { forgotPasswordUser(email: \"owner@p13-browser.example.test\") }" },
      { query: "mutation { resetPasswordUser(token: \"anything\", password: \"attacker-password-1\") { token } }" },
      { query: "query { Users { docs { id email } } }" }
    ];
    for (const attempt of graphqlAttempts) {
      const response = await fetch(`${origin}/api/graphql`, {
        method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie, origin },
        body: JSON.stringify(attempt)
      });
      const text = await response.text();
      assert.equal(response.status, 404, `A GraphQL auth mutation must not be served: ${JSON.stringify(attempt)} -> ${response.status} ${text}`);
      assert.equal(response.headers.get("set-cookie"), null, "A refused GraphQL request must not set a session cookie.");
      assert.equal(/"token"|"data"/u.test(text), false, `A refused GraphQL request must not carry a result: ${text}`);
    }
    // The REST catch-all is what answers the path the route used to own, so the
    // refusal is Payload's own "no such route" rather than a handler of ours.
    const graphqlFallthrough = await fetch(`${origin}/api/graphql`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(graphqlFallthrough.status, 404);
    assert.match(await graphqlFallthrough.text(), /Route not found/u);
    for (const path of ["/api/graphql", "/api/graphql-playground"]) {
      assert.equal((await fetch(`${origin}${path}`, { headers: { cookie: owner.cookie } })).status, 404, `${path} must not be served.`);
    }
    assert.equal(await ownerSessionCount(owner.userId), sessionsBeforeGraphql, "No GraphQL attempt may mint a session.");
    assert.equal((await login(origin, personas.owner.email, personas.owner.password)).status, 200,
      "A refused GraphQL reset-password must leave the credential exactly where it was.");
    assert.notEqual((await login(origin, personas.owner.email, "attacker-password-1")).status, 200);
    // Asserted after the behaviour rather than before it, so reverting the
    // removal is answered by what the route does, not only by what it is.
    for (const source of ["src/app/(payload)/api/graphql/route.ts", "src/app/(payload)/api/graphql-playground/route.ts"]) {
      assert.equal(existsSync(resolve(application, source)), false, `The generated product must not emit ${source}.`);
    }

    // -------- realtime invalidation bridge --------
    const readiness = async () => {
      const response = await fetch(`${origin}/api/readiness`);
      return { status: response.status, body: await response.json() };
    };
    const beforeKill = await readiness();
    assert.equal(beforeKill.status, 200, JSON.stringify(beforeKill.body));
    assert.equal(beforeKill.body.realtime?.state, "connected", `Readiness must report the realtime bridge: ${JSON.stringify(beforeKill.body)}`);
    const listeningBefore = beforeKill.body.realtime.connection;
    const watermarkBefore = beforeKill.body.realtime.watermark;
    assert.ok(Number.isSafeInteger(listeningBefore) && listeningBefore >= 1);
    assert.ok(Number.isSafeInteger(watermarkBefore) && watermarkBefore >= 0);

    const killed = await pool.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and query like 'LISTEN k_nex_runtime_invalidation%'");
    assert.ok(killed.rows.length >= 1, "The generated host must hold a LISTEN backend to terminate.");
    const afterKill = await eventually(async () => {
      const current = await readiness();
      return current.status === 200 && current.body.realtime?.state === "connected" && current.body.realtime.connection > listeningBefore ? current : undefined;
    }, "The generated realtime bridge did not reconnect and resubscribe after its backend was terminated.", 60_000);
    assert.ok(afterKill.body.realtime.watermark >= watermarkBefore, "The realtime watermark must never regress across a reconnect.");
    const relisten = await pool.query("select count(*)::int count from pg_stat_activity where datname=current_database() and query like 'LISTEN k_nex_runtime_invalidation%'");
    assert.ok(relisten.rows[0].count >= 1, "The generated realtime bridge must hold a LISTEN after reconnecting.");

    await pool.query(
      `insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,correlation_id,payload,status,processed_at,retention_until)
       values('p13b-realtime-resync','sales.event.account-changed',1,'durable-integration',now(),$1,'module.sales','p13b-realtime-resync','{}'::jsonb,'delivered',now(),now()+interval '30 days')`,
      [applicationId]
    );
    const resynchronised = await eventually(async () => {
      const current = await readiness();
      return current.status === 200 && current.body.realtime.watermark > afterKill.body.realtime.watermark ? current : undefined;
    }, "The generated realtime bridge did not resynchronise its watermark from the authoritative outbox position.", 60_000);
    assert.equal(resynchronised.body.realtime.state, "connected");

    // -------- credential journey --------
    const restCredentialUpdate = await fetch(`${origin}/api/users/${owner.userId}`, {
      method: "PATCH", headers: { cookie: owner.cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ password: "rest-rewritten-password-1" })
    });
    assert.notEqual(restCredentialUpdate.status, 200, "An ordinary record update must not rewrite a sign-in credential.");
    assert.equal((await login(origin, personas.owner.email, personas.owner.password)).status, 200, "A refused record update must leave the credential intact.");

    const wrongCurrent = inProcessProbe(application, environment, credentialChangeScript, {
      PROBE_COOKIE: owner.cookie,
      PROBE_INPUT: JSON.stringify({ currentPassword: "not-the-current-password", password: "self-service-password-1" })
    });
    assert.deepEqual(wrongCurrent, { ok: false, code: "CREDENTIAL_REAUTHENTICATION_REQUIRED" });
    assert.equal((await login(origin, personas.owner.email, personas.owner.password)).status, 200);

    const selfService = inProcessProbe(application, environment, credentialChangeScript, {
      PROBE_COOKIE: owner.cookie,
      PROBE_INPUT: JSON.stringify({ currentPassword: personas.owner.password, password: "self-service-password-1" })
    });
    assert.equal(selfService.ok, true, JSON.stringify(selfService));
    assert.deepEqual(selfService.value.changed, ["password"]);
    assert.equal(await currentUser(origin, owner.cookie), undefined, "A credential change must revoke every live session.");
    assert.notEqual((await login(origin, personas.owner.email, personas.owner.password)).status, 200, "The replaced password must stop working.");
    const rotated = await login(origin, personas.owner.email, "self-service-password-1");
    assert.equal(rotated.status, 200);
    const credentialAudits = async () => (await pool.query("select count(*)::int count from k_nex_authorization_audit where audit_json->>'operation'='credential-change' and audit_json->>'target'=$1", [owner.userId])).rows[0].count;
    assert.equal(await credentialAudits(), 1);

    // -------- credential boundary failures --------
    // A credential that moved without its audit, or an audit without the
    // credential, is the whole finding. Kill the journey at each boundary in
    // turn and require that nothing survives until the commit does.
    for (const boundary of ["before-write", "credential-written", "after-write", "after-audit"]) {
      boundaryProbe(application, environment, credentialBoundaryScript, boundary, {
        PROBE_COOKIE: rotated.cookie,
        PROBE_INPUT: JSON.stringify({ currentPassword: "self-service-password-1", email: `boundary-${boundary}@p13.example.test`, password: "boundary-refused-password-1" })
      });
      assert.equal((await login(origin, personas.owner.email, "self-service-password-1")).status, 200, `A ${boundary} failure must leave the previous credential working.`);
      assert.notEqual((await login(origin, personas.owner.email, "boundary-refused-password-1")).status, 200, `A ${boundary} failure must not leave the new password working.`);
      assert.notEqual((await login(origin, `boundary-${boundary}@p13.example.test`, "self-service-password-1")).status, 200, `A ${boundary} failure must not leave the new email working.`);
      assert.notEqual((await login(origin, "boundary-orphan@p13.example.test", "self-service-password-1")).status, 200, `A ${boundary} failure must not leave an orphaned credential column behind.`);
      assert.equal(await currentUser(origin, rotated.cookie), owner.userId, `A ${boundary} failure must leave live sessions alone.`);
      assert.equal(await credentialAudits(), 1, `A ${boundary} failure must not write an audit.`);
    }

    // The far side of the same boundary: the commit landed, so the credential
    // moved and carries exactly one audit even though nobody was told.
    boundaryProbe(application, environment, credentialBoundaryScript, "after-commit", {
      PROBE_COOKIE: rotated.cookie,
      PROBE_INPUT: JSON.stringify({ currentPassword: "self-service-password-1", password: "boundary-committed-password-1" })
    });
    assert.notEqual((await login(origin, personas.owner.email, "self-service-password-1")).status, 200, "A committed credential change must replace the old password even when the caller never hears back.");
    assert.equal(await currentUser(origin, rotated.cookie), undefined, "A committed credential change must revoke every live session.");
    const committed = await login(origin, personas.owner.email, "boundary-committed-password-1");
    assert.equal(committed.status, 200);
    assert.equal(await credentialAudits(), 2, "A committed credential change must leave exactly one further audit.");

    // The owner password is now unknown to the operator; only recovery gets it back.
    const directory = mkdtempSync(join(tmpdir(), "p13b-recovery-"));
    try {
      const tokenFile = resolve(directory, "recovery.token");
      const bootstrapReissue = operatorProbe(application, environment, ["knex:issue-bootstrap-token", "--output", resolve(directory, "bootstrap.token")]);
      assert.notEqual(bootstrapReissue.status, 0, "A first-owner bootstrap token must stay unavailable once an owner exists.");

      const issued = operatorProbe(application, environment, ["knex:issue-bootstrap-token", "--recovery", "--output", tokenFile]);
      assert.equal(issued.status, 0, `${issued.stdout}\n${issued.stderr}`);
      assert.match(issued.stdout, /K_NEX_CREDENTIAL_RECOVERY_TOKEN_ISSUED/u);

      const withoutOperator = operatorProbe(application, { ...environment, K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT: "" },
        ["knex:bootstrap-owner", "--recover-credential", "--token-file", tokenFile],
        { K_NEX_OWNER_EMAIL: personas.owner.email, K_NEX_OWNER_PASSWORD: "operatorless-password-1" });
      assert.notEqual(withoutOperator.status, 0, "Recovery must require this deployment's administration operator configuration.");
      assert.notEqual((await login(origin, personas.owner.email, "operatorless-password-1")).status, 200);

      const unspentGrants = async () => (await pool.query("select count(*)::int count from k_nex_owner_bootstrap_tokens where consumed_at is null")).rows[0].count;
      const recoveryAudits = async () => (await pool.query("select count(*)::int count from k_nex_authorization_audit where audit_json->>'operation'='owner-credential-recovery' and audit_json->>'target'=$1", [owner.userId])).rows[0].count;
      assert.equal(await unspentGrants(), 1);

      // The grant is spent on the credential transaction, so a recovery killed
      // anywhere inside that boundary costs the operator nothing: the very same
      // grant file is still spendable, and it is the one the real run below uses.
      for (const boundary of ["before-write", "credential-written", "after-write", "after-audit"]) {
        boundaryProbe(application, environment, recoveryBoundaryScript, boundary, {
          PROBE_TOKEN_FILE: tokenFile,
          PROBE_OPERATOR: environment.K_NEX_ADMINISTRATION_OPERATOR_IDENTITY,
          PROBE_EMAIL: personas.owner.email,
          PROBE_PASSWORD: "boundary-recovered-password-1"
        });
        assert.equal(await unspentGrants(), 1, `A ${boundary} failure must leave the one-shot recovery grant unspent.`);
        assert.equal(await recoveryAudits(), 0, `A ${boundary} failure must not write a recovery audit.`);
        assert.notEqual((await login(origin, personas.owner.email, "boundary-recovered-password-1")).status, 200, `A ${boundary} failure must not move the owner credential.`);
        assert.equal((await login(origin, personas.owner.email, "boundary-committed-password-1")).status, 200, `A ${boundary} failure must leave the owner credential where it was.`);
      }

      // Kept so the spent grant can be presented again; consumption unlinks it.
      const grant = readFileSync(tokenFile, "utf8");
      const recovered = operatorProbe(application, environment,
        ["knex:bootstrap-owner", "--recover-credential", "--token-file", tokenFile],
        { K_NEX_OWNER_EMAIL: personas.owner.email, K_NEX_OWNER_PASSWORD: "operator-recovered-password-1" });
      assert.equal(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
      assert.match(recovered.stdout, new RegExp(`K_NEX_OWNER_CREDENTIAL_RECOVERED ${owner.userId} owner-credential-recovery-[0-9a-f]{32}`, "u"));

      assert.equal(await currentUser(origin, committed.cookie), undefined, "Recovery must revoke every live session.");
      assert.notEqual((await login(origin, personas.owner.email, "boundary-committed-password-1")).status, 200);
      assert.equal((await login(origin, personas.owner.email, "operator-recovered-password-1")).status, 200);
      assert.equal(await unspentGrants(), 0, "The successful recovery must spend the grant the failed attempts left alone.");

      const audit = (await pool.query("select audit_json from k_nex_authorization_audit where audit_json->>'operation'='owner-credential-recovery' and audit_json->>'target'=$1", [owner.userId])).rows;
      assert.equal(audit.length, 1, "Operator recovery must leave exactly one audit record.");
      assert.deepEqual(
        { principal: audit[0].audit_json.principal, outcome: audit[0].audit_json.outcome, reauthentication: audit[0].audit_json.reauthentication, environment: audit[0].audit_json.environment },
        { principal: { kind: "service", id: environment.K_NEX_ADMINISTRATION_OPERATOR_IDENTITY }, outcome: "allow", reauthentication: "satisfied", environment: environmentName }
      );

      writeFileSync(tokenFile, grant, { encoding: "utf8", mode: 0o600 });
      const replayed = operatorProbe(application, environment,
        ["knex:bootstrap-owner", "--recover-credential", "--token-file", tokenFile],
        { K_NEX_OWNER_EMAIL: personas.owner.email, K_NEX_OWNER_PASSWORD: "replayed-recovery-password-1" });
      assert.notEqual(replayed.status, 0, "A consumed recovery grant must not be replayable.");
      assert.notEqual((await login(origin, personas.owner.email, "replayed-recovery-password-1")).status, 200);
      assert.equal((await pool.query("select count(*)::int count from k_nex_owner_bootstrap_tokens where consumed_at is null")).rows[0].count, 0);

      // -------- one credential boundary, under contention --------
      // Sessions are rows, so "no session was left behind" is a count rather
      // than a guess about what a discarded login token did.
      assert.equal((await pool.query("select count(*)::int count from information_schema.tables where table_schema='public' and table_name='users_sessions'")).rows[0].count, 1,
        "The generated users collection must keep its sessions in users_sessions.");
      const ownerSessions = async () => (await pool.query("select count(*)::int count from users_sessions where _parent_id=$1", [owner.userId])).rows[0].count;
      let currentPassword = "operator-recovered-password-1";

      // A correct password whose change is then refused must leave nothing
      // durable behind. The proof used to be a login of its own, so its session
      // survived the transaction that refused the change it was proving.
      const refusalCookie = await login(origin, personas.owner.email, currentPassword);
      assert.equal(refusalCookie.status, 200);
      const sessionsBeforeRefusal = await ownerSessions();
      assert.ok(sessionsBeforeRefusal >= 1, `The owner must hold a live session to count: ${sessionsBeforeRefusal}`);
      const takenEmail = inProcessProbe(application, environment, credentialChangeScript, {
        PROBE_COOKIE: refusalCookie.cookie,
        PROBE_INPUT: JSON.stringify({ currentPassword, email: personas.manager.email })
      });
      assert.deepEqual(takenEmail, { ok: false, code: "CREDENTIAL_EMAIL_TAKEN" });
      assert.equal(await ownerSessions(), sessionsBeforeRefusal, "A correct password refused by a taken email must leave the durable session count byte-identical.");

      boundaryProbe(application, environment, credentialBoundaryScript, "after-write", {
        PROBE_COOKIE: refusalCookie.cookie,
        PROBE_INPUT: JSON.stringify({ currentPassword, password: "rolled-back-password-1" })
      });
      assert.equal(await ownerSessions(), sessionsBeforeRefusal, "A rolled-back credential change must leave the durable session count byte-identical.");
      assert.notEqual((await login(origin, personas.owner.email, "rolled-back-password-1")).status, 200);

      // Two self-service changes presenting the same old password. The first
      // holds the boundary open; the second has to prove its password against
      // what that boundary leaves behind, not against what it read before.
      const firstContender = await login(origin, personas.owner.email, currentPassword);
      const secondContender = await login(origin, personas.owner.email, currentPassword);
      assert.equal(firstContender.status, 200);
      assert.equal(secondContender.status, 200);
      const contenderRelease = resolve(directory, "contender.release");
      const holding = startProbe(application, environment, credentialRaceScript, {
        PROBE_COOKIE: firstContender.cookie, PROBE_HOLD_AT: "credential-write", PROBE_RELEASE_FILE: contenderRelease,
        PROBE_INPUT: JSON.stringify({ currentPassword, password: "contender-one-password-1" })
      });
      await eventually(() => holding.output().includes("PROBE_HELD credential-write") || undefined,
        "The first contender never reached its credential write.", 180_000);
      const challenging = startProbe(application, environment, credentialRaceScript, {
        PROBE_COOKIE: secondContender.cookie,
        PROBE_INPUT: JSON.stringify({ currentPassword, password: "contender-two-password-1" })
      });
      // The second contender is not queued behind the row it wants to write: it
      // is queued behind the lock the first one took before reading anything.
      await eventually(async () => (await pool.query("select count(*)::int count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and wait_event='advisory'")).rows[0].count >= 1 || undefined,
        "The second credential change never queued behind the credential lock.", 180_000);
      assert.equal(await ownerSessions(), sessionsBeforeRefusal + 2, "An uncommitted credential boundary must not publish the session its proof opened.");
      writeFileSync(contenderRelease, "release", { encoding: "utf8" });
      const firstResult = await holding.result();
      const secondResult = await challenging.result();
      assert.equal(firstResult.ok, true, JSON.stringify(firstResult));
      assert.deepEqual(secondResult, { ok: false, code: "CREDENTIAL_REAUTHENTICATION_REQUIRED" },
        "A password proved before a competing change must not still be spendable after it.");
      assert.notEqual((await login(origin, personas.owner.email, "contender-two-password-1")).status, 200, "Only one of two contenders may commit.");
      assert.notEqual((await login(origin, personas.owner.email, currentPassword)).status, 200);
      currentPassword = "contender-one-password-1";
      assert.equal((await login(origin, personas.owner.email, currentPassword)).status, 200);
      assert.equal(await credentialAudits(), 3, "Exactly one of two contenders may leave a credential audit.");

      // An operator recovery racing a self-service change that already holds
      // the old password: recovery must not be undone by that older proof.
      const raceTokenFile = resolve(directory, "race-recovery.token");
      const raceIssued = operatorProbe(application, environment, ["knex:issue-bootstrap-token", "--recovery", "--output", raceTokenFile]);
      assert.equal(raceIssued.status, 0, `${raceIssued.stdout}\n${raceIssued.stderr}`);
      const racingCookie = await login(origin, personas.owner.email, currentPassword);
      assert.equal(racingCookie.status, 200);
      const staleRelease = resolve(directory, "stale.release");
      const stalest = startProbe(application, environment, credentialRaceScript, {
        PROBE_COOKIE: racingCookie.cookie, PROBE_HOLD_AT: "transaction-begin", PROBE_RELEASE_FILE: staleRelease,
        PROBE_INPUT: JSON.stringify({ currentPassword, password: "stale-proof-password-1" })
      });
      // Held before it can open a transaction, which is exactly where a journey
      // that proved the password first would already be holding one.
      await eventually(() => stalest.output().includes("PROBE_HELD transaction-begin") || undefined,
        "The racing credential change never started.", 180_000);
      const raced = operatorProbe(application, environment,
        ["knex:bootstrap-owner", "--recover-credential", "--token-file", raceTokenFile],
        { K_NEX_OWNER_EMAIL: personas.owner.email, K_NEX_OWNER_PASSWORD: "raced-recovery-password-1" });
      assert.equal(raced.status, 0, `${raced.stdout}\n${raced.stderr}`);
      writeFileSync(staleRelease, "release", { encoding: "utf8" });
      assert.deepEqual(await stalest.result(), { ok: false, code: "CREDENTIAL_REAUTHENTICATION_REQUIRED" },
        "An operator recovery must not be overwritten by a password proved before it ran.");
      assert.equal((await login(origin, personas.owner.email, "raced-recovery-password-1")).status, 200, "The recovered credential must be the one that survives.");
      assert.notEqual((await login(origin, personas.owner.email, "stale-proof-password-1")).status, 200);
      assert.equal(await credentialAudits(), 3, "A refused stale proof must not leave a credential audit.");

      // -------- Payload's own sign-in, under the same authority --------
      // Payload accepts a password before it opens the transaction that writes
      // the session, and builds that write out of the user it read beforehand,
      // so a lock around the credential writers alone left the whole of an
      // ordinary sign-in outside the ordering. The sign-in is parked here by
      // holding the users row it is about to update: past the password, inside
      // its transaction, before anything about the session is durable.
      currentPassword = "raced-recovery-password-1";
      const lockWaiters = async (events) => (await pool.query(
        "select count(*)::int count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and wait_event=any($1::text[])",
        [events]
      )).rows[0].count;
      // The generated credential authority is the fixed half of the two-integer
      // advisory space, held as a session lock for the whole of an operation, so
      // "somebody is holding it" is a row rather than an inference.
      const heldCredentialAuthority = async () => (await pool.query(
        "select count(*)::int count from pg_locks where locktype='advisory' and granted and objsubid=2 and classid=1802658915 and database=(select oid from pg_database where datname=current_database())"
      )).rows[0].count;
      const signInTokenFile = resolve(directory, "sign-in-recovery.token");
      const signInIssued = operatorProbe(application, environment, ["knex:issue-bootstrap-token", "--recovery", "--output", signInTokenFile]);
      assert.equal(signInIssued.status, 0, `${signInIssued.stdout}\n${signInIssued.stderr}`);
      assert.equal(await unspentGrants(), 1);
      const recoveryAuditsBefore = await recoveryAudits();

      const holder = await pool.connect();
      let heldUserRow = false;
      let pausedSignInFailure;
      let pausedSignIn;
      let racingRecovery;
      try {
        await holder.query("begin");
        await holder.query("select id from users where id=$1 for update", [owner.userId]);
        heldUserRow = true;
        const sessionsBeforeSignIn = await ownerSessions();
        pausedSignIn = login(origin, personas.owner.email, currentPassword)
          .catch((error) => { pausedSignInFailure = error; return { status: 0 }; });
        await eventually(async () => await lockWaiters(["transactionid", "tuple"]) >= 1 || undefined,
          "The ordinary sign-in never reached the session write it commits.", 60_000);
        assert.equal(await ownerSessions(), sessionsBeforeSignIn, "A sign-in parked before its session write must not have published that session.");
        // The whole of the sign-in is inside the authority, not just the write
        // it is parked on, which is what a credential change has to wait for.
        assert.ok(await heldCredentialAuthority() >= 1,
          "A parked sign-in must be holding the credential authority, not only the row it is about to write.");

        racingRecovery = startProbe(application, environment, recoveryBoundaryScript, {
          PROBE_TOKEN_FILE: signInTokenFile,
          PROBE_OPERATOR: environment.K_NEX_ADMINISTRATION_OPERATOR_IDENTITY,
          PROBE_EMAIL: personas.owner.email,
          PROBE_PASSWORD: "sign-in-race-recovered-password-1"
        });
        // Queued behind the credential authority the sign-in is holding, not
        // behind the users row: it never gets as far as that row.
        await eventually(async () => await lockWaiters(["advisory"]) >= 1 || undefined,
          "The operator recovery never queued behind the credential authority an ordinary sign-in holds.", 120_000);
        assert.equal(await recoveryAudits(), recoveryAuditsBefore, "A queued recovery must not have committed.");
        assert.equal(await unspentGrants(), 1, "A queued recovery must not have spent its grant.");
        await holder.query("commit");
        heldUserRow = false;
      } finally {
        if (heldUserRow) await holder.query("rollback").catch(() => undefined);
        holder.release();
      }
      const resumedSignIn = await pausedSignIn;
      assert.equal(pausedSignInFailure, undefined, `The parked sign-in must be answered: ${pausedSignInFailure}`);
      const racedRecovery = await racingRecovery.result();
      assert.equal(racedRecovery.ok, true, JSON.stringify(racedRecovery));
      // The sign-in ran wholly before the recovery, so it is allowed to have
      // succeeded; what it must not do is outlive the recovery that followed it.
      assert.equal(resumedSignIn.status, 200, "A sign-in against the credential current for the whole of its run must still complete.");
      assert.ok(resumedSignIn.cookie);
      assert.equal(await currentUser(origin, resumedSignIn.cookie), undefined, "No session a sign-in opened may survive the recovery that ran after it.");
      assert.equal(await ownerSessions(), 0, "No post-recovery session may exist for the parked sign-in.");
      assert.notEqual((await login(origin, personas.owner.email, currentPassword)).status, 200, "The recovered-over password must stop working.");
      assert.equal((await pool.query("select count(*)::int count from users where id=$1 and email=$2", [owner.userId, personas.owner.email])).rows[0].count, 1,
        "The recovered email must be byte-identical to the one the operator supplied.");
      currentPassword = "sign-in-race-recovered-password-1";
      const recoveredSignIn = await login(origin, personas.owner.email, currentPassword);
      assert.equal(recoveredSignIn.status, 200, "The recovered password must be byte-identical to the one the operator supplied.");
      assert.equal(await ownerSessions(), 1, "A sign-in against the current credential must create exactly one usable session.");
      assert.equal(await currentUser(origin, recoveredSignIn.cookie), owner.userId);
      assert.equal(await recoveryAudits(), recoveryAuditsBefore + 1, "The recovery must leave exactly one further audit.");
      assert.equal(await unspentGrants(), 0, "The recovery must spend the grant it queued with.");

      // -------- an email-only change, and the session it revoked --------
      // A change that moves only the email leaves the password working, so the
      // second caller proves it happily; the thing that decides is the session
      // the first one revoked before this one ever reached the lock.
      const movedEmail = "moved-owner@p13.example.test";
      const changerA = await login(origin, personas.owner.email, currentPassword);
      const changerB = await login(origin, personas.owner.email, currentPassword);
      assert.equal(changerA.status, 200);
      assert.equal(changerB.status, 200);
      const auditsBeforeEmailOnly = await credentialAudits();
      const emailOnlyRelease = resolve(directory, "email-only.release");
      const holdingEmailOnly = startProbe(application, environment, credentialRaceScript, {
        PROBE_COOKIE: changerA.cookie, PROBE_HOLD_AT: "credential-write", PROBE_RELEASE_FILE: emailOnlyRelease,
        PROBE_INPUT: JSON.stringify({ currentPassword, email: movedEmail })
      });
      await eventually(() => holdingEmailOnly.output().includes("PROBE_HELD credential-write") || undefined,
        "The email-only change never reached its credential write.", 180_000);
      const staleSessionContender = startProbe(application, environment, credentialRaceScript, {
        PROBE_COOKIE: changerB.cookie,
        PROBE_INPUT: JSON.stringify({ currentPassword, password: "email-only-contender-password-1" })
      });
      await eventually(async () => await lockWaiters(["advisory"]) >= 1 || undefined,
        "The second credential change never queued behind the credential authority.", 180_000);
      writeFileSync(emailOnlyRelease, "release", { encoding: "utf8" });
      const emailOnlyResult = await holdingEmailOnly.result();
      const staleSessionResult = await staleSessionContender.result();
      assert.equal(emailOnlyResult.ok, true, JSON.stringify(emailOnlyResult));
      assert.deepEqual(emailOnlyResult.value.changed, ["email"]);
      assert.deepEqual(staleSessionResult, { ok: false, code: "CREDENTIAL_SESSION_REQUIRED" },
        "A session a competing change revoked must not still be spendable, however good the password presented with it is.");
      assert.equal(await credentialAudits(), auditsBeforeEmailOnly + 1, "Exactly one of two contenders may leave a credential audit.");
      assert.notEqual((await login(origin, personas.owner.email, "email-only-contender-password-1")).status, 200);
      assert.notEqual((await login(origin, personas.owner.email, currentPassword)).status, 200, "The moved email must be the only sign-in identity.");
      assert.equal((await login(origin, movedEmail, currentPassword)).status, 200, "An email-only change must leave the password working under the new email.");

      // -------- reauthentication proves, and leaves nothing --------
      // The finding this closes: the step-up proof was a login of its own
      // outside any transaction, so every settings and theme confirmation left
      // a live session behind that nobody held a token for.
      const sessionRows = async () => JSON.stringify((await pool.query("select * from users_sessions order by id")).rows);
      const settingsCookie = await login(origin, movedEmail, currentPassword);
      assert.equal(settingsCookie.status, 200);
      const sessionsBeforeReauthentication = await sessionRows();
      const settingsChange = async (password) => {
        const response = await fetch(`${origin}/api/system/settings/system.general`, {
          method: "POST", redirect: "manual",
          headers: { "content-type": "application/x-www-form-urlencoded", cookie: settingsCookie.cookie, origin },
          body: new URLSearchParams({ password, values: JSON.stringify({ siteName: "P13 CRM Browser", reportingCurrency: "USD", reportingTimezone: "UTC" }) })
        });
        return response.status;
      };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal(await settingsChange(currentPassword), 303, "A settings change with the current password must be admitted.");
        assert.notEqual(await settingsChange("not-the-current-password"), 303, "A settings change must refuse a password it cannot prove.");
      }
      // The same primitive the theme journeys call, driven directly so the
      // proof is of the reauthentication rather than of one route's plumbing.
      const reauthenticated = inProcessProbe(application, environment, reauthenticationScript, {
        PROBE_COOKIE: settingsCookie.cookie,
        PROBE_PASSWORDS: JSON.stringify([currentPassword, "not-the-current-password", currentPassword, currentPassword, "wrong-again", currentPassword])
      });
      assert.deepEqual(reauthenticated, { ok: true, value: [true, false, true, true, false, true] });
      assert.equal(await sessionRows(), sessionsBeforeReauthentication,
        "Repeated settings and theme reauthentication must leave the user's sessions byte-identical.");
      assert.equal(await currentUser(origin, settingsCookie.cookie), owner.userId, "A verification-only proof must leave the caller's own session alone.");

      // -------- one account's sign-in is not every account's sign-in --------
      // The finding this closes: one advisory key for the whole application
      // meant a complete, unauthenticated sign-in request for any address
      // serialized every other sign-in, every credential change and the
      // operator recovery behind it, on an unbounded in-process queue with no
      // deadline and no way out.
      // pg_locks reports the key as an unsigned oid; the generated authority
      // takes it as a signed int4, so it has to be read back as one.
      const advisoryHolders = async () => (await pool.query(
        "select objid from pg_locks where locktype='advisory' and granted and objsubid=2 and classid=1802658915 and database=(select oid from pg_database where datname=current_database())"
      )).rows.map((row) => Number(row.objid) > 2_147_483_647 ? Number(row.objid) - 4_294_967_296 : Number(row.objid));
      const managerId = String((await pool.query("select id from users where email=$1", [personas.manager.email])).rows[0].id);
      let flood;
      let ownerAuthorityKey;
      const floodHolder = await pool.connect();
      let floodRowHeld = false;
      try {
        await floodHolder.query("begin");
        await floodHolder.query("select id from users where id=$1 for update", [owner.userId]);
        floodRowHeld = true;
        flood = Array.from({ length: 40 }, () => login(origin, movedEmail, currentPassword).catch(() => ({ status: 0 })));
        // Waited for as one condition rather than asserted after another: the
        // generated worker holds row locks of its own, so "somebody is waiting
        // on a row" is not by itself this sign-in.
        const held = await eventually(async () => {
          const holders = await advisoryHolders();
          return holders.length >= 1 && await lockWaiters(["transactionid", "tuple"]) >= 1 ? holders : undefined;
        }, "No flooded sign-in parked inside the credential authority.", 60_000);
        assert.equal(held.length, 1, `Exactly one flooded sign-in may park a pooled connection on the authority: ${JSON.stringify(held)}`);
        ownerAuthorityKey = held[0];

        // Another account, while forty requests for this one are in flight.
        const bystanderStartedAt = Date.now();
        const bystander = await login(origin, personas.manager.email, personas.manager.password);
        assert.equal(bystander.status, 200, `A different account must sign in while one account is flooded.\n${applicationOutput()}`);
        assert.ok(Date.now() - bystanderStartedAt < 5_000, `A different account's sign-in must not wait for the flood: ${Date.now() - bystanderStartedAt}ms`);
        assert.equal(await currentUser(origin, bystander.cookie), managerId);

        await floodHolder.query("commit");
        floodRowHeld = false;
      } finally {
        if (floodRowHeld) await floodHolder.query("rollback").catch(() => undefined);
        floodHolder.release();
      }
      const flooded = await Promise.all(flood);
      const floodStatuses = flooded.map(({ status }) => status);
      assert.equal(floodStatuses.every((status) => status === 200 || status === 429), true,
        `A flooded account's sign-ins must be answered or refused, never left hanging: ${JSON.stringify(floodStatuses)}`);
      assert.ok(floodStatuses.filter((status) => status === 429).length >= 25,
        `A bounded queue must refuse the excess rather than accumulate it: ${JSON.stringify(floodStatuses)}`);
      assert.ok(floodStatuses.includes(200), `The flood must not refuse the account outright: ${JSON.stringify(floodStatuses)}`);

      // -------- a client that goes away is not executed on its behalf --------
      const sessionsBeforeAbandon = await ownerSessions();
      const abandonHolder = await pool.connect();
      let abandonRowHeld = false;
      let parked;
      let abandonedFailure;
      try {
        await abandonHolder.query("begin");
        await abandonHolder.query("select id from users where id=$1 for update", [owner.userId]);
        abandonRowHeld = true;
        parked = login(origin, movedEmail, currentPassword);
        await eventually(async () => (await advisoryHolders()).includes(ownerAuthorityKey) && await lockWaiters(["transactionid", "tuple"]) >= 1 || undefined,
          "The parked sign-in never reached the session write it commits.", 60_000);
        const abandoning = new AbortController();
        const abandoned = fetch(`${origin}/api/users/login`, {
          method: "POST", headers: { "content-type": "application/json" }, signal: abandoning.signal,
          body: JSON.stringify({ email: movedEmail, password: currentPassword })
        }).catch((error) => { abandonedFailure = error; return undefined; });
        // Queued behind the parked sign-in, then disconnected: the request must
        // leave the queue rather than be run later on a client that has gone.
        await new Promise((settle) => setTimeout(settle, 1_000));
        abandoning.abort();
        assert.equal(await abandoned, undefined, "An abandoned sign-in must not be answered.");
        assert.ok(abandonedFailure !== undefined);
        await new Promise((settle) => setTimeout(settle, 1_000));
        await abandonHolder.query("commit");
        abandonRowHeld = false;
      } finally {
        if (abandonRowHeld) await abandonHolder.query("rollback").catch(() => undefined);
        abandonHolder.release();
      }
      assert.equal((await parked).status, 200, "A sign-in that waited its turn must still be answered.");
      assert.equal(await ownerSessions(), sessionsBeforeAbandon + 1,
        "An abandoned sign-in must not open a session after its client has gone.");

      // -------- a holder that dies does not keep the authority --------
      const dying = await pool.connect();
      // This connection is about to be terminated on purpose, so the fatal it
      // receives belongs to the test rather than to the process.
      dying.on("error", () => undefined);
      let dyingPid;
      try {
        dyingPid = Number((await dying.query("select pg_backend_pid() pid")).rows[0].pid);
        await dying.query("select pg_advisory_lock($1,$2)", [1_802_658_915, ownerAuthorityKey]);
        assert.deepEqual(await advisoryHolders(), [ownerAuthorityKey]);
        const blocked = login(origin, movedEmail, currentPassword);
        await eventually(async () => await lockWaiters(["advisory"]) >= 1 || undefined,
          "The sign-in never queued behind the authority a foreign holder took.", 30_000);
        await pool.query("select pg_terminate_backend($1)", [dyingPid]);
        const resumedAt = Date.now();
        assert.equal((await blocked).status, 200, "A sign-in must proceed once the holder that died releases the authority.");
        assert.ok(Date.now() - resumedAt < 10_000, "A dead holder's authority must be free at once, not on a deadline.");
      } finally { dying.release(true); }

      // -------- the operator recovery is not behind another account --------
      // The recovery contends for the owner's key, so a sign-in for a different
      // account cannot be in front of it however long that sign-in takes.
      const contentionTokenFile = resolve(directory, "contention-recovery.token");
      const contentionIssued = operatorProbe(application, environment, ["knex:issue-bootstrap-token", "--recovery", "--output", contentionTokenFile]);
      assert.equal(contentionIssued.status, 0, `${contentionIssued.stdout}\n${contentionIssued.stderr}`);
      const contentionAuditsBefore = await recoveryAudits();
      const managerHolder = await pool.connect();
      let managerRowHeld = false;
      let parkedManager;
      let parkedManagerFailure;
      try {
        await managerHolder.query("begin");
        await managerHolder.query("select id from users where id=$1 for update", [managerId]);
        managerRowHeld = true;
        parkedManager = login(origin, personas.manager.email, personas.manager.password)
          .catch((error) => { parkedManagerFailure = error; return { status: 0 }; });
        // The whole of the sign-in is inside its own principal's authority, not
        // only the row it is about to write, which is what a recovery for a
        // different principal must not be behind.
        const managerHeld = await eventually(async () => {
          const holders = await advisoryHolders();
          return holders.length >= 1 && !holders.includes(ownerAuthorityKey) && await lockWaiters(["transactionid", "tuple"]) >= 1 ? holders : undefined;
        }, "The manager sign-in never parked inside its own credential authority.", 60_000);
        assert.ok(await heldCredentialAuthority() >= 1, "A parked sign-in must be holding its own principal's credential authority.");
        assert.equal(managerHeld.includes(ownerAuthorityKey), false, "A manager sign-in must not be holding the owner's credential authority.");
        const recoveringUnderContention = startProbe(application, environment, recoveryBoundaryScript, {
          PROBE_TOKEN_FILE: contentionTokenFile,
          PROBE_OPERATOR: environment.K_NEX_ADMINISTRATION_OPERATOR_IDENTITY,
          PROBE_EMAIL: movedEmail,
          PROBE_PASSWORD: "recovered-under-contention-password-1"
        });
        const contended = await recoveringUnderContention.result();
        assert.equal(contended.ok, true, `An operator recovery must make progress while another account is signing in.\n${JSON.stringify(contended)}`);
        assert.equal(await recoveryAudits(), contentionAuditsBefore + 1);
        await managerHolder.query("commit");
        managerRowHeld = false;
      } finally {
        if (managerRowHeld) await managerHolder.query("rollback").catch(() => undefined);
        managerHolder.release();
      }
      assert.equal((await parkedManager).status, 200, `The parked manager sign-in must still be answered: ${parkedManagerFailure}`);
      currentPassword = "recovered-under-contention-password-1";
      assert.equal((await login(origin, movedEmail, currentPassword)).status, 200, "The recovery that ran under contention must be the credential that survives.");

      // -------- an operation that will not finish loses the authority --------
      // Every holder parks one pooled connection, so a sign-in that never ends
      // would otherwise take a share of the pool out of the product for good.
      const stuckHolder = await pool.connect();
      let stuckRowHeld = false;
      let stuck;
      try {
        await stuckHolder.query("begin");
        await stuckHolder.query("select id from users where id=$1 for update", [owner.userId]);
        stuckRowHeld = true;
        const stuckStartedAt = Date.now();
        stuck = fetch(`${origin}/api/users/login`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: movedEmail, password: currentPassword })
        });
        const refused = await stuck;
        assert.equal(refused.status, 503, `A sign-in past the operation deadline must be refused, not held: ${refused.status}`);
        assert.ok(Date.now() - stuckStartedAt < 30_000, `The operation deadline must be a deadline: ${Date.now() - stuckStartedAt}ms`);
        // The authority and the pooled connection carrying it are both back,
        // which is the whole point of having a deadline at all.
        await eventually(async () => (await advisoryHolders()).includes(ownerAuthorityKey) ? undefined : true,
          "An abandoned operation must not keep the credential authority.", 30_000);
        const afterDeadline = await login(origin, personas.manager.email, personas.manager.password);
        assert.equal(afterDeadline.status, 200, "A refused operation must leave the pool share it held behind it.");
        await stuckHolder.query("commit");
        stuckRowHeld = false;
      } finally {
        if (stuckRowHeld) await stuckHolder.query("rollback").catch(() => undefined);
        stuckHolder.release();
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }

    // -------- a migrated database is not an open registration --------
    // The finding this closes: first-register creates an account with access
    // checks overridden and logs it straight in, so a migrated application
    // started before knex:bootstrap-owner accepted an unauthenticated caller as
    // its first account, outside the one-shot operator token, the protected
    // role baseline receipt, the owner assignment and the audit. Serializing it
    // only made that punctual.
    const bootstrapless = "p13b_bootstrapless";
    await pool.query(`drop database if exists ${bootstrapless}`);
    await pool.query(`create database ${bootstrapless}`);
    const bootstraplessUrl = new URL(environment.DATABASE_URL);
    bootstraplessUrl.pathname = `/${bootstrapless}`;
    const bootstraplessPort = await unusedPort();
    const bootstraplessOrigin = `http://127.0.0.1:${bootstraplessPort}`;
    const bootstraplessEnvironment = { ...environment, DATABASE_URL: bootstraplessUrl.toString(), K_NEX_PUBLIC_ORIGIN: bootstraplessOrigin };
    const bootstraplessPool = new pg.Pool({ connectionString: bootstraplessUrl.toString(), max: 4 });
    const counts = async () => {
      const rows = await bootstraplessPool.query(`select
        (select count(*)::int from users) users,
        (select count(*)::int from users_sessions) sessions,
        (select count(*)::int from k_nex_role_assignments where role_id='system.role.owner') owners,
        (select count(*)::int from k_nex_authorization_bootstrap_receipts) receipts,
        (select count(*)::int from k_nex_authorization_audit) audits`);
      return rows.rows[0];
    };
    let bootstraplessHost;
    let bootstraplessOutput = "";
    try {
      const migrated = spawnSync("pnpm", ["knex:migrate"], { cwd: application, env: bootstraplessEnvironment, encoding: "utf8" });
      assert.equal(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
      const migratedCounts = await counts();
      assert.deepEqual({ users: migratedCounts.users, sessions: migratedCounts.sessions, owners: migratedCounts.owners, receipts: migratedCounts.receipts },
        { users: 0, sessions: 0, owners: 0, receipts: 0 },
        `A migrated database must start with no owner of any kind: ${JSON.stringify(migratedCounts)}`);

      bootstraplessHost = spawn(process.execPath, ["dist/k-nex-web.js"], {
        cwd: application, env: { ...bootstraplessEnvironment, PORT: String(bootstraplessPort) }, stdio: ["ignore", "pipe", "pipe"]
      });
      bootstraplessHost.stdout.setEncoding("utf8").on("data", (chunk) => { bootstraplessOutput += chunk; });
      bootstraplessHost.stderr.setEncoding("utf8").on("data", (chunk) => { bootstraplessOutput += chunk; });
      await eventually(async () => (await fetch(`${bootstraplessOrigin}/api/health`)).ok || undefined,
        `A migrated application must start before it is bootstrapped.\n${bootstraplessOutput}`, 120_000);

      for (const body of [
        { email: "attacker@p13.example.test", password: "attacker-first-owner-1" },
        { email: "ATTACKER@P13.example.test", password: "attacker-first-owner-1" }
      ]) {
        const registered = await fetch(`${bootstraplessOrigin}/api/users/first-register`, {
          method: "POST", headers: { "content-type": "application/json", origin: bootstraplessOrigin }, body: JSON.stringify(body)
        });
        assert.equal(registered.status, 403, `An unauthenticated first-register must be refused: ${await registered.clone().text()}`);
        assert.deepEqual(await registered.json(), { errors: [{ message: "The first owner is created by the operator bootstrap command, not by registration." }] });
        assert.equal(registered.headers.get("set-cookie"), null, "A refused first-register must not mint a session.");
      }
      assert.deepEqual(await counts(), migratedCounts,
        "A refused first-register must leave no account, no session, no owner assignment, no receipt and no audit.");
      assert.notEqual((await login(bootstraplessOrigin, "attacker@p13.example.test", "attacker-first-owner-1")).status, 200);

      // The operator flow is the only way in, and it still is.
      const bootstraplessToken = mkdtempSync(join(tmpdir(), "p13b-bootstrapless-"));
      try {
        const tokenFile = resolve(bootstraplessToken, "owner.token");
        const issued = spawnSync("pnpm", ["knex:issue-bootstrap-token", "--output", tokenFile], { cwd: application, env: bootstraplessEnvironment, encoding: "utf8" });
        assert.equal(issued.status, 0, `${issued.stdout}\n${issued.stderr}`);
        const bootstrapped = spawnSync("pnpm", ["knex:bootstrap-owner", "--token-file", tokenFile], {
          cwd: application, encoding: "utf8",
          env: { ...bootstraplessEnvironment, K_NEX_OWNER_EMAIL: "first-owner@p13.example.test", K_NEX_OWNER_PASSWORD: "first-owner-password-1" }
        });
        assert.equal(bootstrapped.status, 0, `${bootstrapped.stdout}\n${bootstrapped.stderr}`);
        assert.match(bootstrapped.stdout, /K_NEX_OWNER_BOOTSTRAP_PASS/u);
        const bootstrappedCounts = await counts();
        assert.equal(bootstrappedCounts.users, 1, "The operator bootstrap must create exactly one owner.");
        assert.equal(bootstrappedCounts.receipts, 1, "The operator bootstrap must commit exactly one protected owner receipt.");
        assert.equal(bootstrappedCounts.owners, 1, "The operator bootstrap must assign the owner role exactly once.");
        assert.equal((await login(bootstraplessOrigin, "first-owner@p13.example.test", "first-owner-password-1")).status, 200);
        // Still refused once an owner exists, and still for the same reason.
        const afterOwner = await fetch(`${bootstraplessOrigin}/api/users/first-register`, {
          method: "POST", headers: { "content-type": "application/json", origin: bootstraplessOrigin },
          body: JSON.stringify({ email: "second-owner@p13.example.test", password: "second-owner-password-1" })
        });
        assert.equal(afterOwner.status, 403);
        assert.equal((await counts()).users, 1, "A refused first-register must not add an account after bootstrap either.");
      } finally { rmSync(bootstraplessToken, { recursive: true, force: true }); }
    } finally {
      if (bootstraplessHost !== undefined) {
        bootstraplessHost.kill("SIGTERM");
        await new Promise((settle) => bootstraplessHost.once("close", settle));
      }
      await bootstraplessPool.end().catch(() => undefined);
      await pool.query(`drop database if exists ${bootstrapless} with (force)`).catch(() => undefined);
    }
  });
});
